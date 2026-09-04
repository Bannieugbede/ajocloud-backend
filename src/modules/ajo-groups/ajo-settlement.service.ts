import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  AccountType,
  AjoMemberStatus,
  ContributionScheduleStatus,
  ContributionStatus,
  FinancialAccountPurpose,
  PayoutScheduleStatus,
  PayoutStatus,
} from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import {
  TransactionService,
  type TransactionClient,
} from '../../infrastructure/database/transaction.service.js';
import { LedgerService } from '../ledger/ledger.service.js';
import {
  assertContributionAmount,
  canExecutePayout,
  contributionIdempotencyKey,
  contributionScheduleStatusFor,
  isCycleFullyCollected,
  payoutIdempotencyKey,
  poolAccountCode,
} from './domain/ajo-settlement-policy.js';
import type { PayContributionDto } from './dto/pay-contribution.dto.js';

/**
 * Signals that a payout cannot proceed and its schedule should be held.
 *
 * Thrown from inside the settlement transaction, which rolls it back, so the
 * hold is written afterwards by the caller. Carrying the eventual HTTP shape on
 * the error keeps that decision next to the reason for it.
 */
class PayoutHeldError extends Error {
  constructor(
    message: string,
    readonly httpError: new (message: string) => Error = ConflictException,
  ) {
    super(message);
    this.name = 'PayoutHeldError';
  }
}

/**
 * Moves money into and out of an Ajo cycle.
 *
 * Every rule here comes from ADR-011, which in turn exists because ADR-001
 * allows the platform no liquidity float: a cycle pays out only what it has
 * actually collected, and a shortfall holds the payout rather than being
 * covered.
 */
@Injectable()
export class AjoSettlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
    private readonly ledger: LedgerService,
  ) {}

  /**
   * Pays a member's contribution for one cycle from their wallet.
   *
   * The whole thing is one serializable transaction: the wallet balance is read,
   * the ledger is posted, and the schedule is advanced together, so a balance
   * checked and then spent by a concurrent request cannot produce an overdraft.
   */
  async payContribution(
    userId: string,
    groupId: string,
    scheduleId: string,
    dto: PayContributionDto,
  ): Promise<Record<string, unknown>> {
    const amountMinor = BigInt(dto.amountMinor);

    return this.transactions.serializable(async (tx) => {
      const schedule = await tx.contributionSchedule.findUnique({
        where: { id: scheduleId },
        include: { slot: { select: { memberId: true } } },
      });
      if (!schedule || schedule.groupId !== groupId) {
        throw new NotFoundException('That contribution was not found');
      }

      const member = await tx.ajoGroupMember.findUnique({
        where: { groupId_userId: { groupId, userId } },
        select: { id: true, status: true },
      });
      if (!member || member.status !== AjoMemberStatus.ACTIVE) {
        throw new ForbiddenException('You are not an active member of this group');
      }
      // A slot's contribution is owed by whoever holds the slot. Paying another
      // member's obligation would let one person quietly buy a position in
      // someone else's rotation.
      if (schedule.slot.memberId !== member.id) {
        throw new ForbiddenException('That contribution belongs to another member');
      }

      // Idempotency is checked before anything that depends on what has already
      // been paid. A settled contribution has moved amountPaidMinor to the full
      // amount, so validating first would answer a legitimate retry with
      // "already paid in full" rather than the contribution it already made.
      const idempotencyKey = contributionIdempotencyKey(scheduleId, dto.idempotencyKey);
      const existing = await tx.contribution.findUnique({ where: { idempotencyKey } });
      if (existing) return this.view(existing);

      if (
        schedule.status === ContributionScheduleStatus.CANCELLED ||
        schedule.status === ContributionScheduleStatus.WAIVED
      ) {
        throw new ConflictException('That contribution is no longer collectable');
      }

      try {
        assertContributionAmount({
          amountMinor,
          amountDueMinor: schedule.amountDueMinor,
          amountPaidMinor: schedule.amountPaidMinor,
        });
      } catch (error) {
        throw new UnprocessableEntityException((error as Error).message);
      }

      const walletAccount = await this.memberWalletAccount(tx, userId, schedule.currency);
      const poolAccount = await this.poolAccount(tx, groupId, schedule.currency);

      // Re-read inside the transaction rather than trusting a cached summary.
      // A member without the funds gets a refusal; an overdrawn wallet would be
      // a platform float by another name, which ADR-001 forbids.
      const balance = await this.ledger.accountBalanceWithin(tx, walletAccount.id);
      if (balance < amountMinor) {
        throw new UnprocessableEntityException(
          'Your wallet does not have enough for this contribution',
        );
      }

      const posting = await this.ledger.postWithin(tx, {
        idempotencyKey,
        reference: `AJO-CONTRIB-${randomUUID()}`,
        description: `Ajo contribution for schedule ${scheduleId}`,
        currency: schedule.currency,
        initiatedByUserId: userId,
        correlationId: groupId,
        entries: [
          { accountId: walletAccount.id, direction: 'DEBIT', amountMinor },
          { accountId: poolAccount.id, direction: 'CREDIT', amountMinor },
        ],
      });

      const now = new Date();
      const contribution = await tx.contribution.create({
        data: {
          groupId,
          scheduleId,
          memberId: member.id,
          slotId: schedule.slotId,
          amountMinor,
          currency: schedule.currency,
          status: ContributionStatus.SUCCEEDED,
          idempotencyKey,
          ledgerTransactionId: posting.id,
          processedAt: now,
          paidAt: now,
          allocatedAt: now,
        },
      });

      // Derived from the amounts rather than assumed, so a schedule cannot claim
      // to be paid while it is short.
      const amountPaidMinor = schedule.amountPaidMinor + amountMinor;
      await tx.contributionSchedule.update({
        where: { id: scheduleId },
        data: {
          amountPaidMinor,
          status: contributionScheduleStatusFor({
            amountDueMinor: schedule.amountDueMinor,
            amountPaidMinor,
            dueAt: schedule.dueAt,
            now,
          }),
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'ajo.contribution.paid',
          subjectType: 'Contribution',
          subjectId: contribution.id,
          groupId,
          metadata: { scheduleId, amountMinor: amountMinor.toString() },
        },
      });

      return this.view(contribution);
    });
  }

  /**
   * Pays a cycle's pool to the slot whose turn it is.
   *
   * Refuses unless every contribution in the cycle is settled. This is stricter
   * than "the pool covers it" on purpose: a pool can cover this recipient while
   * another member still owes, and paying then spends a later recipient's turn
   * to fund this one (ADR-011).
   */
  async executePayout(
    userId: string,
    groupId: string,
    payoutScheduleId: string,
  ): Promise<Record<string, unknown>> {
    try {
      return await this.settlePayout(userId, groupId, payoutScheduleId);
    } catch (error) {
      if (!(error instanceof PayoutHeldError)) throw error;
      // The transaction has rolled back by now, so this write survives. Held
      // rather than failed: the cycle is waiting on arrears, and settling them
      // should let it proceed without anything being re-created.
      await this.prisma.payoutSchedule.update({
        where: { id: payoutScheduleId },
        data: { status: PayoutScheduleStatus.HELD },
      });
      throw new error.httpError(error.message);
    }
  }

  private async settlePayout(
    userId: string,
    groupId: string,
    payoutScheduleId: string,
  ): Promise<Record<string, unknown>> {
    return this.transactions.serializable(async (tx) => {
      const schedule = await tx.payoutSchedule.findUnique({
        where: { id: payoutScheduleId },
        include: { slot: { select: { memberId: true } } },
      });
      if (!schedule || schedule.groupId !== groupId) {
        throw new NotFoundException('That payout was not found');
      }

      await this.assertGroupAdmin(tx, userId, groupId);

      // Idempotency is checked before the status, not after. A completed payout
      // leaves its schedule PAID, so testing the status first would answer a
      // legitimate retry with a conflict instead of the payout it already made.
      const idempotencyKey = payoutIdempotencyKey(payoutScheduleId);
      const existing = await tx.payout.findUnique({ where: { idempotencyKey } });
      if (existing) return this.view(existing);

      if (!canExecutePayout(schedule.status)) {
        throw new ConflictException('That payout has already been settled');
      }

      const cycleSchedules = await tx.contributionSchedule.findMany({
        where: { cycleId: schedule.cycleId },
        select: { status: true },
      });
      if (!isCycleFullyCollected(cycleSchedules)) {
        // Recorded outside this transaction, because throwing rolls it back:
        // writing the hold here would abort with everything else and leave the
        // schedule looking ready when it is waiting on arrears.
        throw new PayoutHeldError(
          'This cycle has not collected every contribution, so it cannot pay out yet',
        );
      }

      const recipient = await tx.ajoGroupMember.findUnique({
        where: { id: schedule.slot.memberId },
        select: { userId: true },
      });
      if (!recipient) throw new NotFoundException('The payout recipient was not found');

      const poolAccount = await this.poolAccount(tx, groupId, schedule.currency);
      const walletAccount = await this.memberWalletAccount(tx, recipient.userId, schedule.currency);

      // The second guard. The schedule check above is the business rule and
      // could be wrong; this one is the invariant, and it is what stops the
      // platform ever funding a difference.
      const poolBalance = await this.ledger.accountBalanceWithin(tx, poolAccount.id);
      if (poolBalance < schedule.amountDueMinor) {
        throw new PayoutHeldError(
          'This group’s pool does not hold enough for this payout',
          UnprocessableEntityException,
        );
      }

      const posting = await this.ledger.postWithin(tx, {
        idempotencyKey,
        reference: `AJO-PAYOUT-${randomUUID()}`,
        description: `Ajo payout for schedule ${payoutScheduleId}`,
        currency: schedule.currency,
        initiatedByUserId: userId,
        correlationId: groupId,
        entries: [
          { accountId: poolAccount.id, direction: 'DEBIT', amountMinor: schedule.amountDueMinor },
          {
            accountId: walletAccount.id,
            direction: 'CREDIT',
            amountMinor: schedule.amountDueMinor,
          },
        ],
      });

      const now = new Date();
      const payout = await tx.payout.create({
        data: {
          groupId,
          scheduleId: payoutScheduleId,
          memberId: schedule.slot.memberId,
          slotId: schedule.slotId,
          amountMinor: schedule.amountDueMinor,
          currency: schedule.currency,
          status: PayoutStatus.SUCCEEDED,
          idempotencyKey,
          ledgerTransactionId: posting.id,
          processedAt: now,
          initiatedAt: now,
          completedAt: now,
        },
      });

      await tx.payoutSchedule.update({
        where: { id: payoutScheduleId },
        data: { status: PayoutScheduleStatus.PAID, amountPaidMinor: schedule.amountDueMinor },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          action: 'ajo.payout.executed',
          subjectType: 'Payout',
          subjectId: payout.id,
          groupId,
          metadata: {
            payoutScheduleId,
            amountMinor: schedule.amountDueMinor.toString(),
            recipientUserId: recipient.userId,
          },
        },
      });

      return this.view(payout);
    });
  }

  /**
   * The group's pool account, created on first use.
   *
   * Created lazily rather than at lock so that groups locked before this
   * existed still work. It carries no `walletId` on purpose: a group is not a
   * person, and must never acquire the withdraw or spend capabilities that hang
   * off a wallet.
   */
  private async poolAccount(tx: TransactionClient, groupId: string, currency: string) {
    const code = poolAccountCode(groupId);
    const existing = await tx.financialAccount.findUnique({
      where: { code },
      select: { id: true, isActive: true },
    });
    if (existing) {
      if (!existing.isActive) {
        throw new UnprocessableEntityException('This group’s pool account is not active');
      }
      return existing;
    }
    return tx.financialAccount.create({
      data: {
        code,
        name: `Ajo group pool ${groupId}`,
        // A liability: the pooled money belongs to the members, not to us.
        type: AccountType.LIABILITY,
        purpose: FinancialAccountPurpose.AJO_GROUP_POOL,
        currency,
      },
      select: { id: true, isActive: true },
    });
  }

  private async memberWalletAccount(tx: TransactionClient, userId: string, currency: string) {
    const wallet = await tx.wallet.findUnique({
      where: { userId_currency: { userId, currency } },
      select: { id: true },
    });
    if (!wallet) throw new UnprocessableEntityException('No wallet in this currency');

    const account = await tx.financialAccount.findFirst({
      where: {
        walletId: wallet.id,
        purpose: FinancialAccountPurpose.WALLET_AVAILABLE,
        currency,
        isActive: true,
      },
      select: { id: true },
    });
    if (!account) {
      throw new UnprocessableEntityException('Required financial accounts are not configured');
    }
    return account;
  }

  private async assertGroupAdmin(tx: TransactionClient, userId: string, groupId: string) {
    const member = await tx.ajoGroupMember.findUnique({
      where: { groupId_userId: { groupId, userId } },
      select: { role: true, status: true },
    });
    if (!member || member.status !== AjoMemberStatus.ACTIVE || member.role !== 'GROUP_ADMIN') {
      throw new ForbiddenException('Only this group’s active administrator can do that');
    }
  }

  /** BigInt money is serialised as strings, per the repository-wide convention. */
  private view(record: Record<string, unknown>): Record<string, unknown> {
    return Object.fromEntries(
      Object.entries(record).map(([key, value]) => [
        key,
        typeof value === 'bigint' ? value.toString() : value,
      ]),
    );
  }
}
