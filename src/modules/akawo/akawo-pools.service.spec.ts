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

describe('joined pools', () => {
  /** A member's list, with one pool that has three members and two payments. */
  function buildJoined() {
    const pool = {
      id: POOL_ID,
      organiserUserId: ORGANISER,
      name: 'Faculty Week Contribution',
      amountMinor: 3_000_00n,
      currency: 'NGN',
      status: 'OPEN',
      referenceLabel: 'Matric number',
      dueAt: null,
    };

    const prisma = {
      akawoPoolMember: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'membership-1',
            pool,
            dues: [{ id: 'due-1', amountMinor: 3_000_00n, status: 'PENDING', paidAt: null }],
          },
        ]),
        count: jest.fn().mockResolvedValue(3),
      },
      akawoPoolDue: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ amountMinor: 3_000_00n }, { amountMinor: 3_000_00n }]),
      },
      userProfile: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ userId: ORGANISER, firstName: 'Bode', lastName: 'Adewale' }]),
      },
    };

    const service = new AkawoPoolsService(prisma as never, {} as never);
    return { service, prisma };
  }

  it('tells a member how far the collection has got', async () => {
    // Before paying, a member wants to know whether the group is actually
    // paying up. Without these the list can only show what they owe.
    const [entry] = (await buildJoined().service.listJoined('member-1')) as {
      memberCount: number;
      paidCount: number;
      collectedMinor: string;
      expectedMinor: string;
      progressBps: number;
    }[];

    expect(entry).toMatchObject({
      memberCount: 3,
      paidCount: 2,
      collectedMinor: '600000',
      expectedMinor: '900000',
    });
    expect(entry?.progressBps).toBe(6666);
  });

  it('serializes the totals as strings, never as numbers', async () => {
    // A collected total can exceed Number.MAX_SAFE_INTEGER, so it crosses the
    // wire as a string like every other minor-unit amount.
    const [entry] = (await buildJoined().service.listJoined('member-1')) as {
      collectedMinor: unknown;
      expectedMinor: unknown;
    }[];
    expect(typeof entry?.collectedMinor).toBe('string');
    expect(typeof entry?.expectedMinor).toBe('string');
  });

  it('exposes no other member and no organiser account id', async () => {
    // The totals are aggregates on purpose. A member may see how many have
    // paid; who they are is the organiser's record, not theirs.
    const [entry] = (await buildJoined().service.listJoined('member-1')) as {
      pool: Record<string, unknown>;
      members?: unknown;
    }[];
    expect(entry?.pool.organiserName).toBe('Bode Adewale');
    expect(entry?.pool).not.toHaveProperty('organiserUserId');
    // No roster: only the counts. The organiser's view is where names,
    // references and individual payment states live.
    expect(entry).not.toHaveProperty('members');
    expect(JSON.stringify(entry)).not.toContain('reference"');
  });

  it('counts an empty pool as nothing collected rather than dividing by zero', async () => {
    const prisma = {
      akawoPoolMember: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'membership-1',
            pool: {
              id: POOL_ID,
              organiserUserId: ORGANISER,
              name: 'New pool',
              amountMinor: 3_000_00n,
              currency: 'NGN',
              status: 'OPEN',
              referenceLabel: 'Matric number',
              dueAt: null,
            },
            dues: [],
          },
        ]),
        count: jest.fn().mockResolvedValue(0),
      },
      akawoPoolDue: { findMany: jest.fn().mockResolvedValue([]) },
      userProfile: { findMany: jest.fn().mockResolvedValue([]) },
    };

    const service = new AkawoPoolsService(prisma as never, {} as never);
    const [entry] = (await service.listJoined('member-1')) as { progressBps: number }[];
    expect(entry?.progressBps).toBe(0);
  });
});
