import { ConflictException, ForbiddenException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env.schema.js';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { TransactionService } from '../../infrastructure/database/transaction.service.js';
import { firstArg } from '../../common/testing/mock-arguments.js';
import { AjoGroupsService } from './ajo-groups.service.js';
import { digestInvitationCode } from './domain/invitation-code.js';

const PEPPER = 'test-pepper-value';

describe('Ajo group listing', () => {
  const tx = {
    ajoGroup: { findUnique: jest.fn(), update: jest.fn() },
    ajoGroupMember: { findUnique: jest.fn(), create: jest.fn() },
    ajoSlot: { createMany: jest.fn() },
    ajoContributionPlan: { create: jest.fn() },
    groupInvitation: { findUnique: jest.fn(), update: jest.fn() },
    auditLog: { create: jest.fn() },
  };
  const transactions = {
    serializable: jest.fn(async (work: (client: unknown) => Promise<unknown>) => work(tx)),
  };
  const service = new AjoGroupsService(
    {} as PrismaService,
    transactions as unknown as TransactionService,
    { get: () => PEPPER } as unknown as ConfigService<Environment, true>,
  );

  const group = {
    id: 'group-1',
    status: 'OPEN',
    shortCode: '7KQ3MZP',
    publiclyListed: true,
    maxSlots: 12,
    maxMembers: 12,
    minSlotsPerMember: 1,
    maxSlotsPerMember: 2,
    baseContributionMinor: 500_000n,
    contributionUnitMinor: null,
    currency: 'NGN',
    _count: { slots: 3, members: 3 },
  };

  beforeEach(() => {
    jest.clearAllMocks();
    tx.ajoGroup.findUnique.mockResolvedValue(group);
    tx.ajoGroupMember.create.mockResolvedValue({ id: 'member-9' });
    tx.groupInvitation.findUnique.mockResolvedValue(null);
  });

  describe('joining', () => {
    it('admits anyone with a listed group’s public code, spending no invitation', async () => {
      await expect(
        service.join('user-9', 'group-1', { invitationCode: '7kq3mzp', requestedSlots: 1 }),
      ).resolves.toEqual({ memberId: 'member-9', slots: 1 });
      expect(tx.groupInvitation.findUnique).not.toHaveBeenCalled();
      expect(tx.groupInvitation.update).not.toHaveBeenCalled();
      const audit = firstArg<{ data: { metadata: unknown } }>(tx.auditLog.create);
      expect(audit.data.metadata).toEqual({ via: 'listing' });
    });

    it('refuses the public code once the group is unlisted', async () => {
      tx.ajoGroup.findUnique.mockResolvedValue({ ...group, publiclyListed: false });
      await expect(
        service.join('user-9', 'group-1', { invitationCode: '7KQ3MZP', requestedSlots: 1 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(tx.ajoGroupMember.create).not.toHaveBeenCalled();
    });

    it('refuses another listed group’s public code', async () => {
      await expect(
        service.join('user-9', 'group-1', { invitationCode: '2AC4DEF', requestedSlots: 1 }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });

    it('still admits with an invitation, and spends it', async () => {
      tx.ajoGroup.findUnique.mockResolvedValue({ ...group, publiclyListed: false });
      tx.groupInvitation.findUnique.mockResolvedValue({
        id: 'invite-1',
        groupId: 'group-1',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 60_000),
        useCount: 0,
        maxUses: 5,
      });
      await service.join('user-9', 'group-1', {
        invitationCode: 'whe4ntdh27',
        requestedSlots: 1,
      });
      const lookup = firstArg<{ where: { tokenDigest: string } }>(tx.groupInvitation.findUnique);
      expect(lookup.where.tokenDigest).toBe(digestInvitationCode('WHE4NTDH27', PEPPER));
      expect(tx.groupInvitation.update).toHaveBeenCalledWith({
        where: { id: 'invite-1' },
        data: { useCount: { increment: 1 } },
      });
    });
  });

  describe('listing and unlisting', () => {
    beforeEach(() => {
      tx.ajoGroupMember.findUnique.mockResolvedValue({ role: 'GROUP_ADMIN', status: 'ACTIVE' });
      tx.ajoGroup.findUnique.mockResolvedValue({ status: 'OPEN', publiclyListed: false });
      tx.ajoGroup.update.mockResolvedValue({
        id: 'group-1',
        shortCode: '7KQ3MZP',
        publiclyListed: true,
      });
    });

    it('lets the administrator list the group, and records it', async () => {
      await expect(service.setListing('user-1', 'group-1', true)).resolves.toMatchObject({
        publiclyListed: true,
      });
      const audit = firstArg<{ data: { action: string } }>(tx.auditLog.create);
      expect(audit.data.action).toBe('ajo.group.listed');
    });

    it('refuses anyone but the administrator', async () => {
      tx.ajoGroupMember.findUnique.mockResolvedValue({ role: 'MEMBER', status: 'ACTIVE' });
      await expect(service.setListing('user-2', 'group-1', true)).rejects.toBeInstanceOf(
        ForbiddenException,
      );
      expect(tx.ajoGroup.update).not.toHaveBeenCalled();
    });

    it('will not list a group that has locked its rotation', async () => {
      tx.ajoGroup.findUnique.mockResolvedValue({ status: 'LOCKED', publiclyListed: false });
      await expect(service.setListing('user-1', 'group-1', true)).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('always lets a group be unlisted', async () => {
      tx.ajoGroup.findUnique.mockResolvedValue({ status: 'ACTIVE', publiclyListed: true });
      await expect(service.setListing('user-1', 'group-1', false)).resolves.toBeDefined();
      const audit = firstArg<{ data: { action: string } }>(tx.auditLog.create);
      expect(audit.data.action).toBe('ajo.group.unlisted');
    });

    it('writes no audit entry when nothing changes', async () => {
      tx.ajoGroup.findUnique.mockResolvedValue({ status: 'OPEN', publiclyListed: true });
      await service.setListing('user-1', 'group-1', true);
      expect(tx.auditLog.create).not.toHaveBeenCalled();
    });
  });
});
