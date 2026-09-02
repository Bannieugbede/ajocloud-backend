import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { AkawoPoolsService } from './akawo-pools.service.js';

type WriteArgs = { where?: unknown; data: Record<string, unknown>; select?: unknown };
type WriteResult = Record<string, unknown>;

/** First call's arguments, failing loudly when the write never happened. */
function firstWrite(mock: jest.Mock<WriteResult, [WriteArgs]>): WriteArgs {
  const call = mock.mock.calls[0];
  if (!call) throw new Error('Expected the write to have been called, but it was not');
  return call[0];
}

const ORGANISER = 'organiser-1';
const POOL_ID = 'pool-1';

type PoolSeed = {
  status?: string;
  organiserUserId?: string;
  missing?: boolean;
  paidCount?: number;
  dueStatus?: string;
};

function build(seed: PoolSeed = {}) {
  const pool = seed.missing
    ? null
    : {
        id: POOL_ID,
        status: seed.status ?? 'OPEN',
        organiserUserId: seed.organiserUserId ?? ORGANISER,
        amountMinor: 5_000_00n,
        currency: 'NGN',
        referenceLabel: 'Matric number',
        name: 'Class of 2026 dues',
      };

  const calls = {
    poolUpdate: jest.fn<WriteResult, [WriteArgs]>(({ data }) => ({ id: POOL_ID, ...data })),
    dueUpdate: jest.fn<WriteResult, [WriteArgs]>(({ data }) => ({ id: 'due-1', ...data })),
    memberUpdate: jest.fn<WriteResult, [WriteArgs]>(({ data }) => ({ id: 'member-1', ...data })),
    auditCreate: jest.fn().mockResolvedValue({}),
  };

  const tx = {
    akawoPool: { findUnique: jest.fn().mockResolvedValue(pool), update: calls.poolUpdate },
    akawoPoolDue: {
      count: jest.fn().mockResolvedValue(seed.paidCount ?? 0),
      findUnique: jest
        .fn()
        .mockResolvedValue(
          seed.dueStatus === 'MISSING'
            ? null
            : { id: 'due-1', status: seed.dueStatus ?? 'PENDING' },
        ),
      update: calls.dueUpdate,
    },
    akawoPoolMember: { update: calls.memberUpdate },
    auditLog: { create: calls.auditCreate },
  };

  const prisma = { akawoPool: { findUnique: jest.fn().mockResolvedValue(pool) } };
  const transactions = {
    serializable: <T>(operation: (client: unknown) => Promise<T>): Promise<T> => operation(tx),
  };

  const service = new AkawoPoolsService(prisma as never, transactions as never);
  return { service, calls, tx };
}

describe('ownership', () => {
  it('refuses a pool the caller does not organise', async () => {
    const { service } = build({ organiserUserId: 'someone-else' });
    await expect(service.close(ORGANISER, POOL_ID)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('reports a missing pool rather than creating one', async () => {
    const { service } = build({ missing: true });
    await expect(service.close(ORGANISER, POOL_ID)).rejects.toBeInstanceOf(NotFoundException);
  });
});

describe('lifecycle transitions', () => {
  it('opens a draft pool', async () => {
    const { service, calls } = build({ status: 'DRAFT' });
    await service.open(ORGANISER, POOL_ID);
    expect(firstWrite(calls.poolUpdate).data).toMatchObject({ status: 'OPEN' });
  });

  it('refuses to reopen a closed pool', async () => {
    const { service, calls } = build({ status: 'CLOSED' });
    await expect(service.open(ORGANISER, POOL_ID)).rejects.toBeInstanceOf(ConflictException);
    expect(calls.poolUpdate).not.toHaveBeenCalled();
  });

  it('stamps closedAt when a pool closes', async () => {
    const { service, calls } = build({ status: 'OPEN' });
    await service.close(ORGANISER, POOL_ID);
    expect(firstWrite(calls.poolUpdate).data.closedAt).toBeInstanceOf(Date);
  });
});

describe('cancellation', () => {
  it('cancels a pool that has taken nothing', async () => {
    const { service, calls } = build({ status: 'OPEN', paidCount: 0 });
    await service.cancel(ORGANISER, POOL_ID);
    expect(firstWrite(calls.poolUpdate).data).toMatchObject({ status: 'CANCELLED' });
  });

  it('refuses to cancel once money has arrived, since there is no refund path', async () => {
    const { service, calls } = build({ status: 'OPEN', paidCount: 3 });
    await expect(service.cancel(ORGANISER, POOL_ID)).rejects.toThrow(/cannot be cancelled/i);
    expect(calls.poolUpdate).not.toHaveBeenCalled();
  });
});

describe('members and dues', () => {
  it('removes a member who has not paid', async () => {
    const { service, calls } = build({ dueStatus: 'PENDING' });
    await service.removeMember(ORGANISER, POOL_ID, 'member-1');
    expect(firstWrite(calls.memberUpdate).data).toMatchObject({ status: 'REMOVED' });
  });

  it('refuses to remove a member who has paid', async () => {
    const { service, calls } = build({ dueStatus: 'PAID' });
    await expect(service.removeMember(ORGANISER, POOL_ID, 'member-1')).rejects.toBeInstanceOf(
      ConflictException,
    );
    expect(calls.memberUpdate).not.toHaveBeenCalled();
  });

  it('waives an outstanding due without claiming money arrived', async () => {
    const { service, calls } = build({ dueStatus: 'PENDING' });
    await service.waiveDue(ORGANISER, POOL_ID, 'member-1', {
      reason: 'Paid the department directly',
    });
    const data = firstWrite(calls.dueUpdate).data;
    expect(data.status).toBe('WAIVED');
    // WAIVED is deliberately not PAID: nothing was collected.
    expect(data.paidAt).toBeUndefined();
    expect(data.ledgerTransactionId).toBeUndefined();
  });

  it('refuses to waive a due that is already settled', async () => {
    const { service, calls } = build({ dueStatus: 'PAID' });
    await expect(
      service.waiveDue(ORGANISER, POOL_ID, 'member-1', { reason: 'Changed my mind' }),
    ).rejects.toBeInstanceOf(ConflictException);
    expect(calls.dueUpdate).not.toHaveBeenCalled();
  });
});

describe('paid state', () => {
  it('is never written by this service', () => {
    // The guarantee from ADR-007: a due becomes PAID only when the payment
    // workflow posts a settled ledger transaction. Asserted against the source
    // because it is a rule about what the file may not contain, and a future
    // edit that breaks it would otherwise pass every behavioural test.
    const source = readFileSync(join(__dirname, 'akawo-pools.service.ts'), 'utf8');
    // Only writes are forbidden. Reading PAID — filtering a `where`, or counting
    // how much has been collected — is exactly what this service should do.
    const writes = source.match(/data:\s*\{[^}]*AkawoDueStatus\.PAID/gs) ?? [];
    expect(writes).toEqual([]);
    expect(source).not.toMatch(/paidAt:\s*new Date\(\)/);
  });
});
