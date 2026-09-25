import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AjoMemberStatus,
  ContributionScheduleStatus,
  PaymentMethod,
  PaymentTargetType,
} from '../../../generated/prisma/enums.js';
import type { TransactionClient } from '../../infrastructure/database/transaction.service.js';
import { PaymentAmountError, partialAmount } from '../payments/domain/payment-policy.js';
import type {
  PaymentTarget,
  PaymentTargetClient,
  ResolvedTarget,
  SettledPayment,
} from '../payments/targets/payment-target.js';
import { AjoSettlementService } from './ajo-settlement.service.js';
import { contributionIdempotencyKey } from './domain/ajo-settlement-policy.js';

/**
 * One member's contribution for one round of an Ajo group. The target id is
 * the contribution schedule.
 *
 * Part payment is allowed because the schedule's status is derived from what
 * has actually arrived (`contributionScheduleStatusFor`): paying part of a
 * round leaves it PARTIALLY_PAID, never PAID, so it cannot be used to underpay.
 * The money goes to the group's own pool account, the same one payouts are
 * made from (ADR-011).
 */
@Injectable()
export class AjoContributionTarget implements PaymentTarget {
  readonly type = PaymentTargetType.AJO_CONTRIBUTION;
  readonly methods = [PaymentMethod.WALLET] as const;
  readonly amountRule = 'partial' as const;

  constructor(private readonly settlement: AjoSettlementService) {}

  async resolve(
    client: PaymentTargetClient,
    userId: string,
    scheduleId: string | null,
    requestedAmountMinor: bigint | null,
  ): Promise<ResolvedTarget> {
    const { schedule } = await this.owed(client, userId, scheduleId);

    if (
      schedule.status === ContributionScheduleStatus.CANCELLED ||
      schedule.status === ContributionScheduleStatus.WAIVED
    ) {
      throw new ConflictException('That contribution is no longer collectable');
    }
    if (schedule.status === ContributionScheduleStatus.PAID) {
      throw new ConflictException('This contribution has already been paid');
    }

    let amountMinor: bigint;
    try {
      amountMinor = partialAmount(
        schedule.amountDueMinor - schedule.amountPaidMinor,
        requestedAmountMinor,
      );
    } catch (error) {
      if (error instanceof PaymentAmountError) {
        throw new UnprocessableEntityException(error.message);
      }
      throw error;
    }

    return {
      amountMinor,
      currency: schedule.currency,
      description: this.label(schedule.group.name, schedule.cycle.sequence),
    };
  }

  async creditAccount(tx: TransactionClient, scheduleId: string | null, currency: string) {
    const schedule = scheduleId
      ? await tx.contributionSchedule.findUnique({
          where: { id: scheduleId },
          select: { groupId: true },
        })
      : null;
    if (!schedule) throw new NotFoundException('That contribution was not found');
    return this.settlement.poolAccountWithin(tx, schedule.groupId, currency);
  }

  async settle(tx: TransactionClient, payment: SettledPayment): Promise<void> {
    const { schedule, memberId } = await this.owed(tx, payment.userId, payment.targetId);
    await this.settlement.recordContributionWithin(tx, {
      userId: payment.userId,
      memberId,
      schedule,
      amountMinor: payment.amountMinor,
      // Derived from the intent, so the contribution row cannot be written twice
      // for one payment however the confirmation is retried.
      idempotencyKey: contributionIdempotencyKey(schedule.id, `intent:${payment.intentId}`),
      ledgerTransactionId: payment.ledgerTransactionId,
    });
  }

  async describe(client: PaymentTargetClient, scheduleId: string | null): Promise<string> {
    const schedule = scheduleId
      ? await client.contributionSchedule
          .findUnique({
            where: { id: scheduleId },
            select: { group: { select: { name: true } }, cycle: { select: { sequence: true } } },
          })
          .catch(() => null)
      : null;
    return schedule ? this.label(schedule.group.name, schedule.cycle.sequence) : 'Ajo contribution';
  }

  /**
   * The schedule, provided the caller is the active member who holds its slot.
   *
   * Anything else is reported as not found rather than forbidden: a payment
   * endpoint must not confirm that someone else's contribution exists.
   */
  private async owed(client: PaymentTargetClient, userId: string, scheduleId: string | null) {
    const schedule = scheduleId
      ? await client.contributionSchedule.findUnique({
          where: { id: scheduleId },
          include: {
            slot: { select: { memberId: true } },
            group: { select: { name: true } },
            cycle: { select: { sequence: true } },
          },
        })
      : null;
    if (!schedule) throw new NotFoundException('That contribution was not found');

    const member = await client.ajoGroupMember.findUnique({
      where: { groupId_userId: { groupId: schedule.groupId, userId } },
      select: { id: true, status: true },
    });
    // A slot's contribution is owed by whoever holds the slot. Paying another
    // member's would let one person quietly buy into someone else's position.
    if (
      !member ||
      member.status !== AjoMemberStatus.ACTIVE ||
      schedule.slot.memberId !== member.id
    ) {
      throw new NotFoundException('That contribution was not found');
    }
    return { schedule, memberId: member.id };
  }

  private label(groupName: string, sequence: number): string {
    return `Ajo: ${groupName}, round ${sequence}`;
  }
}
