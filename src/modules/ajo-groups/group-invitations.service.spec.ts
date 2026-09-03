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
    ajoGroupMember: { findUnique: jest.fn() },
    groupInvitation: { findMany: jest.fn(), findUnique: jest.fn() },
    userProfile: { findUnique: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const transactions = {
    serializable: jest.fn(async (work: (client: unknown) => Promise<unknown>) => work(tx)),
  };
  const config = {
    get: (key: string) => (key === 'TOKEN_PEPPER' ? PEPPER : 'https://ajo.example.com/'),
  };

  const service = new GroupInvitationsService(
    prisma as unknown as PrismaService,
    transactions as unknown as TransactionService,
    config as unknown as ConfigService<Environment, true>,
  );

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

    it('issues a code long enough not to be guessed', async () => {
      const issued = await service.create('user-1', 'group-1', { maxUses: 1 });
      // join refuses anything shorter than 32 characters.
      expect(issued.code.length).toBeGreaterThanOrEqual(32);
    });

    it('builds a link on the public web origin, not the API', async () => {
      const issued = await service.create('user-1', 'group-1', { maxUses: 1 });
      // The trailing slash on the configured origin must not survive into a
      // doubled path separator.
      expect(issued.url).toBe(`https://ajo.example.com/join/${issued.code}`);
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
        name: 'Lagos Traders Ajo',
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
      await service.preview('a-code-that-is-at-least-32-characters');
      const query = firstArg<{ where: { tokenDigest: string } }>(prisma.groupInvitation.findUnique);
      expect(query.where.tokenDigest).toBe(
        digestInvitationCode('a-code-that-is-at-least-32-characters', PEPPER),
      );
    });

    it('names the group and the inviter so the page can be rendered', async () => {
      const preview = await service.preview('code');
      expect(preview.groupName).toBe('Lagos Traders Ajo');
      expect(preview.contributionAmountMinor).toBe('500000');
      expect(preview.memberCount).toBe(7);
    });

    it('abbreviates the inviter surname rather than exposing it in full', async () => {
      // Whoever holds a forwarded link is a stranger to this group. "Ada O." is
      // enough for a real invitee to recognise; a full name is not theirs to
      // hand out.
      const preview = await service.preview('code');
      expect(preview.inviterName).toBe('Ada O.');
    });

    it('discloses no group identifier or membership detail', async () => {
      const preview = await service.preview('code');
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
      await expect(service.preview('code')).rejects.toBeInstanceOf(NotFoundException);
    });

    it('renders a preview even when the inviter has no profile row', async () => {
      prisma.userProfile.findUnique.mockResolvedValue(null);
      await expect(service.preview('code')).resolves.toMatchObject({ inviterName: 'A member' });
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
