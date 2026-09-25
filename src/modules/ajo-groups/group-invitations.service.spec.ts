import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env.schema.js';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { TransactionService } from '../../infrastructure/database/transaction.service.js';
import { firstArg } from '../../common/testing/mock-arguments.js';
import { digestInvitationCode } from './domain/invitation-code.js';
import { GroupInvitationsService } from './group-invitations.service.js';

const PEPPER = 'test-pepper-value';

describe('GroupInvitationsService', () => {
  const tx = {
    ajoGroupMember: { findUnique: jest.fn() },
    ajoGroup: { findUnique: jest.fn() },
    groupInvitation: {
      count: jest.fn(),
      create: jest.fn(),
      findUnique: jest.fn(),
      update: jest.fn(),
    },
  };
  const prisma = {
    ajoGroup: { findUnique: jest.fn() },
    ajoGroupMember: { findUnique: jest.fn(), findFirst: jest.fn() },
    groupInvitation: { findMany: jest.fn(), findUnique: jest.fn() },
    userProfile: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const transactions = {
    serializable: jest.fn(async (work: (client: unknown) => Promise<unknown>) => work(tx)),
  };
  const serviceFor = (webUrl: string) =>
    new GroupInvitationsService(
      prisma as unknown as PrismaService,
      transactions as unknown as TransactionService,
      {
        get: (key: string) => (key === 'TOKEN_PEPPER' ? PEPPER : webUrl),
      } as unknown as ConfigService<Environment, true>,
    );
  const service = serviceFor('https://ajo.example.com/');

  const INVITE = 'WHE4NTDH27';

  const createdRow = {
    id: 'invite-1',
    status: 'ACTIVE',
    maxUses: 1,
    useCount: 0,
    expiresAt: new Date(Date.now() + 86_400_000),
    createdAt: new Date(),
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.ajoGroupMember.findUnique.mockResolvedValue({ id: 'member-1', status: 'ACTIVE' });
    tx.ajoGroup.findUnique.mockResolvedValue({ status: 'OPEN' });
    tx.groupInvitation.count.mockResolvedValue(0);
    tx.groupInvitation.create.mockResolvedValue(createdRow);
    prisma.auditLog.create.mockResolvedValue({});
  });

  describe('create', () => {
    it('stores only the digest of the code it returns', async () => {
      const issued = await service.create('user-1', 'group-1', { maxUses: 1 });

      const written = firstArg<{ data: { tokenDigest: string } }>(tx.groupInvitation.create);
      expect(written.data.tokenDigest).not.toBe(issued.code);
      // The guarantee that matters: the stored value is derivable from the code
      // and the pepper, and nothing else. A bare hash would also pass "not the
      // code", so this pins the exact construction the redeem side uses.
      expect(written.data.tokenDigest).toBe(digestInvitationCode(issued.code, PEPPER));
    });

    it('issues a short code, in the alphabet people can retype', async () => {
      const issued = await service.create('user-1', 'group-1', { maxUses: 1 });
      expect(issued.code).toMatch(/^[2345679ACDEFGHJKMNPQRTUVWXYZ]{10}$/);
    });

    it.each([
      ['https://ajo.example.com/'],
      ['https://ajo.example.com/admin'],
      ['https://ajo.example.com/admin/'],
    ])('builds a short link on the public site root from %s', async (webUrl) => {
      // Neither a trailing slash nor the console path may survive into the
      // link: /admin bounces anyone without a session, which is every invitee.
      const issued = await serviceFor(webUrl).create('user-1', 'group-1', { maxUses: 1 });
      expect(issued.url).toBe(`https://ajo.example.com/g/${issued.code}`);
    });

    it('refuses a caller who is not an active member', async () => {
      tx.ajoGroupMember.findUnique.mockResolvedValue({ id: 'member-1', status: 'EXITED' });
      await expect(service.create('user-1', 'group-1', { maxUses: 1 })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it('refuses a caller with no membership at all', async () => {
      tx.ajoGroupMember.findUnique.mockResolvedValue(null);
      await expect(service.create('user-1', 'group-1', { maxUses: 1 })).rejects.toBeInstanceOf(
        ForbiddenException,
      );
    });

    it.each([['LOCKED'], ['ACTIVE'], ['COMPLETED'], ['CANCELLED']])(
      'refuses to invite into a %s group, which join would reject anyway',
      async (status) => {
        tx.ajoGroup.findUnique.mockResolvedValue({ status });
        await expect(service.create('user-1', 'group-1', { maxUses: 1 })).rejects.toBeInstanceOf(
          ConflictException,
        );
      },
    );

    it('caps how many live invitations one member may hold open', async () => {
      tx.groupInvitation.count.mockResolvedValue(20);
      await expect(service.create('user-1', 'group-1', { maxUses: 1 })).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('writes an audit entry naming the issuer', async () => {
      await service.create('user-1', 'group-1', { maxUses: 1 });
      const entry = firstArg<{ data: Record<string, unknown> }>(prisma.auditLog.create);
      expect(entry.data.actorUserId).toBe('user-1');
      expect(entry.data.action).toBe('ajo.invitation.created');
      expect(entry.data.subjectId).toBe('invite-1');
    });
  });

  describe('preview', () => {
    const liveInvitation = {
      status: 'ACTIVE',
      expiresAt: new Date(Date.now() + 86_400_000),
      useCount: 0,
      maxUses: 1,
      createdBy: { userId: 'user-inviter' },
      group: {
        id: 'group-1',
        name: 'Lagos Traders Ajo',
        description: 'For members only',
        startDate: new Date('2026-11-01T00:00:00Z'),
        status: 'OPEN',
        currency: 'NGN',
        maxMembers: 20,
        baseContributionMinor: 500_000n,
        contributionUnitMinor: null,
        contributionFrequency: 'MONTHLY',
        _count: { members: 7 },
      },
    };

    beforeEach(() => {
      prisma.groupInvitation.findUnique.mockResolvedValue(liveInvitation);
      prisma.userProfile.findUnique.mockResolvedValue({
        firstName: 'Ada',
        lastName: 'Okafor',
      });
    });

    it('looks the invitation up by digest, never by the raw code', async () => {
      await service.preview(INVITE.toLowerCase());
      const query = firstArg<{ where: { tokenDigest: string } }>(prisma.groupInvitation.findUnique);
      // Digested in canonical form, so a code retyped in lower case still works.
      expect(query.where.tokenDigest).toBe(digestInvitationCode(INVITE, PEPPER));
    });

    it('still reads an invitation issued before short links', async () => {
      const legacy = 'q7Xv3nRk2LpZ8sWt4YbG1mHc6dJfN0uA9eKiOxPzQrE';
      await service.preview(legacy);
      const query = firstArg<{ where: { tokenDigest: string } }>(prisma.groupInvitation.findUnique);
      expect(query.where.tokenDigest).toBe(digestInvitationCode(legacy, PEPPER));
    });

    it('says it came from an invitation, and withholds what only a listing publishes', async () => {
      const preview = await service.preview(INVITE);
      expect(preview).toMatchObject({ kind: 'invitation', shortCode: null, description: null });
      expect(preview.expiresAt).toBe(liveInvitation.expiresAt.toISOString());
    });

    it('names the group and the inviter so the page can be rendered', async () => {
      const preview = await service.preview(INVITE);
      expect(preview.groupName).toBe('Lagos Traders Ajo');
      expect(preview.contributionAmountMinor).toBe('500000');
      expect(preview.memberCount).toBe(7);
    });

    it('abbreviates the inviter surname rather than exposing it in full', async () => {
      // Whoever holds a forwarded link is a stranger to this group. "Ada O." is
      // enough for a real invitee to recognise; a full name is not theirs to
      // hand out.
      const preview = await service.preview(INVITE);
      expect(preview.inviterName).toBe('Ada O.');
    });

    it('discloses no group identifier or membership detail', async () => {
      const preview = await service.preview(INVITE);
      const keys = Object.keys(preview);
      expect(keys).not.toContain('groupId');
      expect(keys).not.toContain('members');
      expect(JSON.stringify(preview)).not.toContain('user-inviter');
    });

    it.each([
      ['an unknown code', null],
      ['a revoked invitation', { ...liveInvitation, status: 'REVOKED' }],
      ['an expired invitation', { ...liveInvitation, expiresAt: new Date(Date.now() - 1_000) }],
      ['a spent invitation', { ...liveInvitation, useCount: 1, maxUses: 1 }],
      [
        'a group that has stopped accepting members',
        { ...liveInvitation, group: { ...liveInvitation.group, status: 'LOCKED' } },
      ],
    ])('reports %s the same way, so codes cannot be probed', async (_label, row) => {
      prisma.groupInvitation.findUnique.mockResolvedValue(row);
      await expect(service.preview(INVITE)).rejects.toBeInstanceOf(NotFoundException);
    });

    it('refuses a code of no known shape before looking anything up', async () => {
      await expect(service.preview('not-a-code')).rejects.toBeInstanceOf(NotFoundException);
      expect(prisma.groupInvitation.findUnique).not.toHaveBeenCalled();
    });

    it('renders a preview even when the inviter has no profile row', async () => {
      prisma.userProfile.findUnique.mockResolvedValue(null);
      await expect(service.preview(INVITE)).resolves.toMatchObject({ inviterName: 'A member' });
    });
  });

  describe('a listed group, by its public code', () => {
    const listedGroup = {
      id: 'group-1',
      shortCode: '7KQ3MZP',
      publiclyListed: true,
      deletedAt: null,
      name: 'Lagos Traders Ajo',
      description: 'Monthly savings for market traders',
      status: 'OPEN',
      currency: 'NGN',
      maxMembers: 20,
      baseContributionMinor: 500_000n,
      contributionUnitMinor: null,
      contributionFrequency: 'MONTHLY',
      startDate: new Date('2026-11-01T00:00:00Z'),
      _count: { members: 7 },
    };

    beforeEach(() => {
      prisma.ajoGroup.findUnique.mockResolvedValue(listedGroup);
      prisma.ajoGroupMember.findFirst.mockResolvedValue({ userId: 'user-admin' });
      prisma.userProfile.findUnique.mockResolvedValue({ firstName: 'Ada', lastName: 'Okafor' });
    });

    it('describes the group, naming its administrator, with the code to index', async () => {
      const preview = await service.preview('7kq3mzp');
      expect(prisma.ajoGroup.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { shortCode: '7KQ3MZP' } }),
      );
      expect(preview).toMatchObject({
        kind: 'listed',
        shortCode: '7KQ3MZP',
        description: 'Monthly savings for market traders',
        inviterName: 'Ada O.',
        expiresAt: null,
      });
      expect(prisma.groupInvitation.findUnique).not.toHaveBeenCalled();
      expect(Object.keys(preview)).not.toContain('groupId');
    });

    it.each([
      ['unlisted', { ...listedGroup, publiclyListed: false }],
      ['deleted', { ...listedGroup, deletedAt: new Date() }],
      ['locked', { ...listedGroup, status: 'LOCKED' }],
      ['unknown', null],
    ])('reports an %s group exactly like a wrong code', async (_label, row) => {
      prisma.ajoGroup.findUnique.mockResolvedValue(row);
      prisma.groupInvitation.findUnique.mockResolvedValue(null);
      await expect(service.preview('7KQ3MZP')).rejects.toThrow(
        'This invitation is no longer valid',
      );
    });

    it('resolves to the group for a signed-in member, so they can join with the same code', async () => {
      await expect(service.resolveGroup('7KQ3MZP')).resolves.toEqual({
        groupId: 'group-1',
        groupName: 'Lagos Traders Ajo',
      });
    });
  });

  describe('revoke', () => {
    beforeEach(() => {
      tx.groupInvitation.findUnique.mockResolvedValue({
        id: 'invite-1',
        groupId: 'group-1',
        createdByMemberId: 'member-1',
        status: 'ACTIVE',
      });
      tx.groupInvitation.update.mockResolvedValue({});
    });

    it('marks the invitation revoked', async () => {
      await service.revoke('user-1', 'group-1', 'invite-1');
      const update = firstArg<{ data: { status: string } }>(tx.groupInvitation.update);
      expect(update.data.status).toBe('REVOKED');
    });

    it('refuses to revoke an invitation another member issued', async () => {
      tx.groupInvitation.findUnique.mockResolvedValue({
        id: 'invite-1',
        groupId: 'group-1',
        createdByMemberId: 'member-someone-else',
        status: 'ACTIVE',
      });
      await expect(service.revoke('user-1', 'group-1', 'invite-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
      expect(tx.groupInvitation.update).not.toHaveBeenCalled();
    });

    it('refuses to revoke an invitation belonging to another group', async () => {
      tx.groupInvitation.findUnique.mockResolvedValue({
        id: 'invite-1',
        groupId: 'group-other',
        createdByMemberId: 'member-1',
        status: 'ACTIVE',
      });
      await expect(service.revoke('user-1', 'group-1', 'invite-1')).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('is idempotent for an invitation that is already dead', async () => {
      tx.groupInvitation.findUnique.mockResolvedValue({
        id: 'invite-1',
        groupId: 'group-1',
        createdByMemberId: 'member-1',
        status: 'REVOKED',
      });
      await expect(service.revoke('user-1', 'group-1', 'invite-1')).resolves.toBeUndefined();
      expect(tx.groupInvitation.update).not.toHaveBeenCalled();
    });
  });

  describe('list', () => {
    it('returns only the caller’s own invitations, without any code', async () => {
      prisma.ajoGroupMember.findUnique.mockResolvedValue({ id: 'member-1', status: 'ACTIVE' });
      prisma.groupInvitation.findMany.mockResolvedValue([createdRow]);

      const result = await service.list('user-1', 'group-1');

      const query = firstArg<{ where: Record<string, unknown> }>(prisma.groupInvitation.findMany);
      expect(query.where.createdByMemberId).toBe('member-1');
      expect(JSON.stringify(result)).not.toContain('tokenDigest');
    });
  });
});
