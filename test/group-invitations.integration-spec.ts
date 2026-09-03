import { PrismaPg } from '@prisma/adapter-pg';
import { randomUUID } from 'node:crypto';
import { Prisma, PrismaClient } from '../generated/prisma/client.js';
import {
  AjoGroupStatus,
  AjoMemberRole,
  AjoMemberStatus,
  ContributionFrequency,
  GroupInvitationStatus,
  UserStatus,
} from '../generated/prisma/enums.js';
import type { Environment } from '../src/config/env.schema.js';
import type { ConfigService } from '@nestjs/config';
import type { PrismaService } from '../src/infrastructure/database/prisma.service.js';
import type { TransactionService } from '../src/infrastructure/database/transaction.service.js';
import { AjoGroupsService } from '../src/modules/ajo-groups/ajo-groups.service.js';
import { GroupInvitationsService } from '../src/modules/ajo-groups/group-invitations.service.js';

const runDatabaseTests =
  process.env.CI === 'true' || process.env.RUN_DATABASE_INTEGRATION === 'true';
const describeWithDatabase = runDatabaseTests ? describe : describe.skip;

const PEPPER = 'integration-pepper';

/**
 * Proves the invitation loop end to end against real PostgreSQL.
 *
 * The unit tests prove each side in isolation, which is exactly the shape of
 * bug that hides here: issuing and redeeming hash the code in two different
 * files, and if they ever disagree every invitation is silently unredeemable
 * while both suites stay green.
 */
describeWithDatabase('Group invitations (PostgreSQL integration)', () => {
  jest.setTimeout(120_000);

  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is required for integration tests');
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const transactions = {
    run: <T>(
      operation: (tx: Prisma.TransactionClient) => Promise<T>,
      isolationLevel: Prisma.TransactionIsolationLevel = Prisma.TransactionIsolationLevel
        .ReadCommitted,
    ) => prisma.$transaction(operation, { isolationLevel, maxWait: 15_000, timeout: 30_000 }),
    serializable: <T>(operation: (tx: Prisma.TransactionClient) => Promise<T>) =>
      prisma.$transaction(operation, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 15_000,
        timeout: 30_000,
      }),
  };
  const config = {
    get: (key: string) => (key === 'TOKEN_PEPPER' ? PEPPER : 'https://ajo.example.com'),
  } as unknown as ConfigService<Environment, true>;

  const invitations = new GroupInvitationsService(
    prisma as unknown as PrismaService,
    transactions as unknown as TransactionService,
    config,
  );
  const groups = new AjoGroupsService(
    prisma as unknown as PrismaService,
    transactions as unknown as TransactionService,
    config,
  );

  let ownerId: string;
  let joinerId: string;
  let secondJoinerId: string;
  let strangerId: string;
  let groupId: string;

  beforeAll(async () => {
    const suffix = randomUUID();
    const user = (label: string) =>
      prisma.user
        .create({
          data: {
            email: `${label}-${suffix}@example.test`,
            status: UserStatus.ACTIVE,
            profile: { create: { firstName: 'Ada', lastName: 'Okafor' } },
          },
        })
        .then((row) => row.id);

    [ownerId, joinerId, secondJoinerId, strangerId] = await Promise.all([
      user('owner'),
      user('joiner'),
      user('joiner2'),
      user('stranger'),
    ]);

    const group = await prisma.ajoGroup.create({
      data: {
        name: `Lagos Traders ${suffix}`,
        status: AjoGroupStatus.OPEN,
        contributionFrequency: ContributionFrequency.MONTHLY,
        baseContributionMinor: 500_000n,
        maxSlots: 20,
        maxMembers: 20,
        minSlotsPerMember: 1,
        maxSlotsPerMember: 5,
        startDate: new Date('2026-10-01'),
        endDate: new Date('2027-09-01'),
        createdByUserId: ownerId,
        members: {
          create: {
            userId: ownerId,
            role: AjoMemberRole.GROUP_ADMIN,
            status: AjoMemberStatus.ACTIVE,
            joinedAt: new Date(),
          },
        },
      },
    });
    groupId = group.id;
  });

  afterAll(async () => prisma.$disconnect());

  it('issues a code that the join path actually accepts', async () => {
    const issued = await invitations.create(ownerId, groupId, { maxUses: 1 });

    // The whole point of this suite: a code minted by one service, redeemed by
    // another, through the real column.
    await expect(
      groups.join(joinerId, groupId, { invitationCode: issued.code, requestedSlots: 1 }),
    ).resolves.toMatchObject({ slots: 1 });
  });

  it('describes the group to an unauthenticated caller holding the code', async () => {
    const issued = await invitations.create(ownerId, groupId, { maxUses: 1 });
    const preview = await invitations.preview(issued.code);

    expect(preview.groupName).toContain('Lagos Traders');
    expect(preview.inviterName).toBe('Ada O.');
    expect(preview.contributionAmountMinor).toBe('500000');
  });

  it('refuses a second redemption of a single-use code', async () => {
    const issued = await invitations.create(ownerId, groupId, { maxUses: 1 });
    await groups.join(secondJoinerId, groupId, {
      invitationCode: issued.code,
      requestedSlots: 1,
    });

    await expect(
      groups.join(strangerId, groupId, { invitationCode: issued.code, requestedSlots: 1 }),
    ).rejects.toThrow(/invalid or expired/i);
  });

  it('stops previewing a code once it has been spent', async () => {
    const issued = await invitations.create(ownerId, groupId, { maxUses: 1 });
    await groups.join(strangerId, groupId, { invitationCode: issued.code, requestedSlots: 1 });

    await expect(invitations.preview(issued.code)).rejects.toThrow(/no longer valid/i);
  });

  it('stops a revoked code from being redeemed', async () => {
    const issued = await invitations.create(ownerId, groupId, { maxUses: 5 });
    await invitations.revoke(ownerId, groupId, issued.id);

    const later = await prisma.user
      .create({
        data: { email: `late-${randomUUID()}@example.test`, status: UserStatus.ACTIVE },
      })
      .then((row) => row.id);

    await expect(
      groups.join(later, groupId, { invitationCode: issued.code, requestedSlots: 1 }),
    ).rejects.toThrow(/invalid or expired/i);
  });

  it('never stores the code it hands out', async () => {
    const issued = await invitations.create(ownerId, groupId, { maxUses: 1 });
    const row = await prisma.groupInvitation.findUniqueOrThrow({ where: { id: issued.id } });

    expect(row.tokenDigest).not.toBe(issued.code);
    const found = await prisma.groupInvitation.findFirst({
      where: { tokenDigest: issued.code },
    });
    expect(found).toBeNull();
  });

  it('refuses to issue an invitation to a non-member', async () => {
    // A user created here rather than reused: the shared fixtures join the
    // group in earlier tests, and an outsider is exactly what this asserts.
    const outsider = await prisma.user
      .create({
        data: { email: `outsider-${randomUUID()}@example.test`, status: UserStatus.ACTIVE },
      })
      .then((row) => row.id);

    await expect(invitations.create(outsider, groupId, { maxUses: 1 })).rejects.toThrow(
      /active member/i,
    );
  });

  it('lists the issuer’s invitations with their derived status', async () => {
    const issued = await invitations.create(ownerId, groupId, { maxUses: 3 });
    const { items } = await invitations.list(ownerId, groupId);

    const mine = items.find((item) => item.id === issued.id);
    expect(mine?.status).toBe(GroupInvitationStatus.ACTIVE);
    expect(mine?.remainingUses).toBe(3);
  });
});
