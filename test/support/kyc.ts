import type { PrismaClient } from '../../generated/prisma/client.js';

/**
 * Gives a test user the evidence for all three verification stages (ADR-015),
 * for suites whose subject is not KYC but which act as a group admin.
 */
export async function grantFullVerification(prisma: PrismaClient, userId: string): Promise<void> {
  await prisma.userProfile.update({
    where: { userId },
    data: { dateOfBirth: new Date('1990-01-01'), gender: 'FEMALE', occupation: 'Trader' },
  });
  await prisma.transactionPin.create({ data: { userId, pinHash: 'not-a-real-hash' } });
  await prisma.kycProfile.create({
    data: {
      userId,
      tier: 'TIER_3',
      level: 3,
      status: 'VERIFIED',
      checks: {
        create: [
          { type: 'NIN', provider: 'test', status: 'PASSED' },
          { type: 'ADDRESS', provider: 'test', status: 'PASSED' },
        ],
      },
      documents: {
        create: { type: 'NIN_SLIP', storageKey: `test:${userId}`, contentHash: 'test' },
      },
    },
  });
}
