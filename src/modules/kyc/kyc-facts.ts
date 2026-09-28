import { ForbiddenException } from '@nestjs/common';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { TransactionClient } from '../../infrastructure/database/transaction.service.js';
import {
  KYC_ACTION_STAGES,
  completedLevel,
  refusalMessage,
  type CheckState,
  type KycAction,
  type KycFacts,
  type KycStage,
} from './domain/kyc-stage-policy.js';

export type KycFactsClient = PrismaService | TransactionClient;

/** Document types that satisfy stage 2's upload. */
export const NIN_DOCUMENT_TYPES = ['NIN_SLIP', 'NIN_CARD'] as const;
export type NinDocumentType = (typeof NIN_DOCUMENT_TYPES)[number];

/** The machine-readable code on every staged-verification refusal. */
export const KYC_STAGE_REQUIRED = 'KYC_STAGE_REQUIRED';

/**
 * A check type's state across every attempt: one pass is enough, otherwise the
 * most recent attempt decides, so a failure followed by a pending retry reads
 * as pending rather than failed.
 */
function stateOf(checks: readonly { status: string; createdAt: Date }[]): CheckState {
  if (checks.some((check) => check.status === 'PASSED')) return 'passed';
  const latest = [...checks].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())[0];
  if (!latest) return 'none';
  if (latest.status === 'FAILED' || latest.status === 'ERROR') return 'failed';
  return 'pending';
}

function present(value: string | null | undefined): boolean {
  return typeof value === 'string' && value.trim().length > 0;
}

/**
 * Everything staging is decided from, read in one round trip.
 *
 * A plain function rather than a provider so the guard can use it from any
 * module without importing this one, and so a transaction can pass its own
 * client and read consistently with its writes.
 */
export async function readKycFacts(client: KycFactsClient, userId: string): Promise<KycFacts> {
  const user = await client.user.findUnique({
    where: { id: userId },
    select: {
      status: true,
      profile: {
        select: {
          firstName: true,
          lastName: true,
          dateOfBirth: true,
          gender: true,
          occupation: true,
        },
      },
      transactionPin: { select: { id: true } },
      kycProfile: {
        select: {
          status: true,
          restrictedAt: true,
          checks: {
            where: { type: { in: ['NIN', 'VNIN', 'ADDRESS'] } },
            select: { type: true, status: true, createdAt: true },
          },
          documents: {
            where: { type: { in: [...NIN_DOCUMENT_TYPES] }, supersededAt: null },
            select: { id: true },
            take: 1,
          },
        },
      },
    },
  });

  const profile = user?.profile;
  const kyc = user?.kycProfile;
  const checks = kyc?.checks ?? [];
  return {
    accountActive: user?.status === 'ACTIVE',
    basicInfoComplete: Boolean(
      profile &&
      present(profile.firstName) &&
      present(profile.lastName) &&
      profile.dateOfBirth &&
      profile.gender &&
      present(profile.occupation),
    ),
    pinSet: Boolean(user?.transactionPin),
    nin: stateOf(checks.filter((check) => check.type === 'NIN' || check.type === 'VNIN')),
    ninDocumentUploaded: (kyc?.documents.length ?? 0) > 0,
    address: stateOf(checks.filter((check) => check.type === 'ADDRESS')),
    restricted: kyc?.status === 'REJECTED' || Boolean(kyc?.restrictedAt),
  };
}

export class KycStageRequiredException extends ForbiddenException {
  constructor(action: KycAction, facts: KycFacts) {
    super({
      code: KYC_STAGE_REQUIRED,
      message: refusalMessage(action, facts),
      details: {
        action,
        requiredStage: KYC_ACTION_STAGES[action],
        completedStages: completedLevel(facts),
      },
    });
  }
}

/** Refuses `action` unless `userId` has completed the stage it needs. */
export async function assertKycStage(
  client: KycFactsClient,
  userId: string,
  action: KycAction,
): Promise<void> {
  const facts = await readKycFacts(client, userId);
  const required: KycStage = KYC_ACTION_STAGES[action];
  if (completedLevel(facts) < required) throw new KycStageRequiredException(action, facts);
}

/**
 * Money paid into a group or pool is handled by whoever runs it, so a group
 * whose admin is not fully verified takes no new members or payments, even
 * one created before staged verification existed.
 */
export async function assertOrganiserVerified(
  client: KycFactsClient,
  organiserUserId: string,
): Promise<void> {
  const facts = await readKycFacts(client, organiserUserId);
  if (completedLevel(facts) < 3) {
    throw new ForbiddenException({
      code: 'ORGANISER_NOT_VERIFIED',
      message:
        'The admin of this group has not finished verification, so it cannot take members or payments yet.',
    });
  }
}
