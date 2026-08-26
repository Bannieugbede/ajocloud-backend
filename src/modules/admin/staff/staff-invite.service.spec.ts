import { BadRequestException, ConflictException, ForbiddenException } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import { StaffInviteStatus } from '../../../../generated/prisma/enums.js';
import { StaffInviteService, INVITE_TTL_HOURS } from './staff-invite.service.js';
import type { InviteStaffDto } from '../dto/staff-invite.dto.js';

const PEPPER = 'test-pepper';
const INVITER = 'inviter-1';
const ROLE = { id: 'role-1', name: 'SUPPORT_OFFICER' };

const digest = (token: string): string => createHmac('sha256', PEPPER).update(token).digest('hex');

const configWith = (adminWebUrl = 'https://ajocloud.com') => ({
  get: (key: string) => (key === 'TOKEN_PEPPER' ? PEPPER : adminWebUrl),
});
const config = configWith();

interface InviteRow {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  roleId: string;
  tokenHash: string;
  status: StaffInviteStatus;
  invitedById: string;
  expiresAt: Date;
  acceptedAt: Date | null;
  createdAt: Date;
  role: { name: string };
}

function inviteRow(overrides: Partial<InviteRow> = {}): InviteRow {
  return {
    id: 'invite-1',
    email: 'ada@ajocloud.com',
    firstName: 'Ada',
    lastName: 'Okafor',
    roleId: ROLE.id,
    tokenHash: digest('good-token'),
    status: StaffInviteStatus.PENDING,
    invitedById: INVITER,
    expiresAt: new Date(Date.now() + 60 * 60 * 1_000),
    acceptedAt: null,
    createdAt: new Date('2026-08-26T10:00:00.000Z'),
    role: { name: ROLE.name },
    ...overrides,
  };
}

function build(
  options: {
    invite?: InviteRow | null;
    existingUser?: { id: string } | null;
    role?: { id: string; name: string } | null;
    config?: { get: (key: string) => string };
  } = {},
) {
  const tx = {
    staffInvite: {
      findUnique: jest.fn().mockResolvedValue(options.invite ?? null),
      updateMany: jest.fn().mockResolvedValue({ count: 0 }),
      create: jest.fn().mockResolvedValue(inviteRow()),
      update: jest.fn().mockResolvedValue(inviteRow({ status: StaffInviteStatus.ACCEPTED })),
    },
    user: {
      findUnique: jest.fn().mockResolvedValue(options.existingUser ?? null),
      create: jest.fn().mockResolvedValue({ id: 'new-staff-1' }),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const prisma = {
    // `role` is only defaulted when the key is absent: passing null must stay
    // null so the missing-role path can be exercised.
    role: {
      findUnique: jest.fn().mockResolvedValue('role' in options ? options.role : ROLE),
    },
    user: { findUnique: jest.fn().mockResolvedValue(options.existingUser ?? null) },
    userProfile: {
      findUnique: jest.fn().mockResolvedValue({ firstName: 'Chidi', lastName: 'Eze' }),
    },
    staffInvite: {
      findUnique: jest.fn().mockResolvedValue(options.invite ?? null),
      findMany: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue(inviteRow({ status: StaffInviteStatus.REVOKED })),
    },
    auditLog: { create: jest.fn().mockResolvedValue({}) },
  };
  const transactions = {
    serializable: jest.fn((operation: (client: unknown) => Promise<unknown>) => operation(tx)),
  };
  const notifications = { sendEmail: jest.fn().mockResolvedValue({ status: 'SENT' }) };
  const service = new StaffInviteService(
    prisma as never,
    transactions as never,
    notifications as never,
    (options.config ?? config) as never,
  );
  return { service, prisma, tx, notifications };
}

const dto: InviteStaffDto = {
  email: 'Ada@AjoCloud.com',
  firstName: 'Ada',
  lastName: 'Okafor',
  role: 'SUPPORT_OFFICER',
};

describe('StaffInviteService.invite', () => {
  it('emails a link carrying the raw token, and stores only its digest', async () => {
    const { service, tx, notifications } = build();
    await service.invite(dto, INVITER);

    const [[emailed]] = notifications.sendEmail.mock.calls as [
      [{ variables: { inviteUrl: string } }],
    ];
    const token = new URL(emailed.variables.inviteUrl).searchParams.get('token');
    expect(token).toBeTruthy();

    const [[created]] = tx.staffInvite.create.mock.calls as [[{ data: { tokenHash: string } }]];
    // The stored value must be the digest, never the token itself.
    expect(created.data.tokenHash).toBe(digest(token as string));
    expect(created.data.tokenHash).not.toBe(token);
  });

  it('points the link at the invite page, which lives outside /admin', async () => {
    const { service, notifications } = build();
    await service.invite(dto, INVITER);
    const [[emailed]] = notifications.sendEmail.mock.calls as [
      [{ variables: { inviteUrl: string } }],
    ];
    expect(new URL(emailed.variables.inviteUrl).pathname).toBe('/invite');
  });

  // ADMIN_WEB_URL was set to the console path in production, which sent every
  // invitee to /admin/invite — a 404, on a link that cannot be re-sent without
  // revoking the invite first.
  it.each(['https://ajocloud.com/admin', 'https://ajocloud.com/admin/', 'https://ajocloud.com/'])(
    'tolerates ADMIN_WEB_URL set to %s',
    async (adminWebUrl) => {
      const { service, notifications } = build({ config: configWith(adminWebUrl) });
      await service.invite(dto, INVITER);
      const [[emailed]] = notifications.sendEmail.mock.calls as [
        [{ variables: { inviteUrl: string } }],
      ];
      const url = new URL(emailed.variables.inviteUrl);
      expect(url.pathname).toBe('/invite');
      expect(url.origin).toBe('https://ajocloud.com');
    },
  );

  it('normalises the address so invites cannot be duplicated by casing', async () => {
    const { service, tx } = build();
    await service.invite(dto, INVITER);
    const [[created]] = tx.staffInvite.create.mock.calls as [[{ data: { email: string } }]];
    expect(created.data.email).toBe('ada@ajocloud.com');
  });

  it('revokes an outstanding invite before issuing a new one', async () => {
    const { service, tx } = build();
    await service.invite(dto, INVITER);
    expect(tx.staffInvite.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { email: 'ada@ajocloud.com', status: StaffInviteStatus.PENDING },
      }),
    );
  });

  it('refuses to invite someone who already has an account', async () => {
    const { service } = build({ existingUser: { id: 'user-9' } });
    await expect(service.invite(dto, INVITER)).rejects.toBeInstanceOf(ConflictException);
  });

  it('rejects a role that does not exist', async () => {
    const { service } = build({ role: null });
    await expect(service.invite(dto, INVITER)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('reports a failed send rather than claiming the email went out', async () => {
    // The invite row is committed before delivery is attempted, so a rejected
    // send must be visible — otherwise nobody knows to resend it.
    const { service, notifications } = build();
    notifications.sendEmail.mockResolvedValue({ status: 'FAILED' });
    await expect(service.invite(dto, INVITER)).resolves.toMatchObject({
      deliveryStatus: 'FAILED',
    });
  });

  it('expires the invitation after the documented window', async () => {
    const { service, tx } = build();
    await service.invite(dto, INVITER);
    const [[created]] = tx.staffInvite.create.mock.calls as [[{ data: { expiresAt: Date } }]];
    const hours = (created.data.expiresAt.getTime() - Date.now()) / (60 * 60 * 1_000);
    expect(Math.round(hours)).toBe(INVITE_TTL_HOURS);
  });
});

describe('StaffInviteService.accept', () => {
  it('creates an active staff account holding the invited role', async () => {
    const { service, tx } = build({ invite: inviteRow() });
    await expect(service.accept('good-token', 'a-long-password')).resolves.toEqual({
      userId: 'new-staff-1',
    });
    const [[created]] = tx.user.create.mock.calls as [
      [
        {
          data: {
            status: string;
            emailVerifiedAt: Date;
            roleAssignments: { create: { roleId: string } };
          };
        },
      ],
    ];
    expect(created.data.status).toBe('ACTIVE');
    // Redeeming a link sent to the mailbox proves control of the address.
    expect(created.data.emailVerifiedAt).toBeInstanceOf(Date);
    expect(created.data.roleAssignments.create.roleId).toBe(ROLE.id);
  });

  it('stores a hash, never the password itself', async () => {
    const { service, tx } = build({ invite: inviteRow() });
    await service.accept('good-token', 'a-long-password');
    const [[created]] = tx.user.create.mock.calls as [
      [{ data: { credential: { create: { passwordHash: string } } } }],
    ];
    const stored = created.data.credential.create.passwordHash;
    expect(stored).toMatch(/^\$argon2id\$/);
    expect(stored).not.toContain('a-long-password');
  });

  it('rejects a token that matches no invitation', async () => {
    const { service } = build({ invite: null });
    await expect(service.accept('wrong-token', 'a-long-password')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects an invitation that has expired', async () => {
    const expired = inviteRow({ expiresAt: new Date(Date.now() - 1_000) });
    const { service } = build({ invite: expired });
    await expect(service.accept('good-token', 'a-long-password')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects an invitation that was already accepted', async () => {
    const used = inviteRow({ status: StaffInviteStatus.ACCEPTED });
    const { service } = build({ invite: used });
    await expect(service.accept('good-token', 'a-long-password')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('rejects an invitation that was revoked', async () => {
    const revoked = inviteRow({ status: StaffInviteStatus.REVOKED });
    const { service } = build({ invite: revoked });
    await expect(service.accept('good-token', 'a-long-password')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('does not create a second account when the link is opened twice', async () => {
    // The first tab consumed the invite; the row is no longer PENDING when the
    // second tab re-reads it inside the transaction.
    const { service, tx } = build({ invite: inviteRow() });
    tx.staffInvite.findUnique.mockResolvedValue(inviteRow({ status: StaffInviteStatus.ACCEPTED }));
    await expect(service.accept('good-token', 'a-long-password')).rejects.toBeInstanceOf(
      ForbiddenException,
    );
    expect(tx.user.create).not.toHaveBeenCalled();
  });
});

describe('StaffInviteService.preview', () => {
  it('describes a live invitation without exposing the role id', async () => {
    const { service } = build({ invite: inviteRow() });
    const preview = await service.preview('good-token');
    expect(preview).toMatchObject({
      email: 'ada@ajocloud.com',
      firstName: 'Ada',
      lastName: 'Okafor',
      // The console shows a readable role, not the internal enum or its id.
      role: 'Support Officer',
    });
    expect(typeof preview.expiresAt).toBe('string');
    expect(Object.keys(preview)).not.toContain('roleId');
  });

  it('reports a revoked invitation the same way as an unknown token', async () => {
    // Distinguishing them would let a guessed token confirm a real address.
    const unknown = build({ invite: null });
    const revoked = build({ invite: inviteRow({ status: StaffInviteStatus.REVOKED }) });
    const message = async (service: StaffInviteService, token: string) =>
      service.preview(token).catch((error: Error) => error.message);
    expect(await message(unknown.service, 'nope')).toBe(
      await message(revoked.service, 'good-token'),
    );
  });
});
