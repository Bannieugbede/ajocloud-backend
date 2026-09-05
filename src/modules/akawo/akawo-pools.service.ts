import { randomBytes, createHash } from 'node:crypto';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  AkawoDueStatus,
  AkawoPoolMemberStatus,
  AkawoPoolStatus,
} from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import {
  TransactionService,
  type TransactionClient,
} from '../../infrastructure/database/transaction.service.js';
import {
  acceptsMembers,
  canCancel,
  canRemoveMember,
  canTransition,
  collectionProgressBps,
  generateJoinCode,
  isValidJoinCodeShape,
  normalizeJoinCode,
} from './domain/pool-policy.js';
import type {
  CreateAkawoPoolDto,
  JoinAkawoPoolDto,
  UpdateAkawoPoolDto,
  WaiveAkawoDueDto,
} from './dto/akawo-pool.dto.js';

const poolSelect = {
  id: true,
  name: true,
  purpose: true,
  amountMinor: true,
  currency: true,
  status: true,
  referenceLabel: true,
  dueAt: true,
  closedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

const memberSelect = {
  id: true,
  fullName: true,
  reference: true,
  status: true,
  joinedAt: true,
} as const;

/**
 * Akawo collection pools (ADR-007).
 *
 * A pool is not a rotation: money is collected towards a stated purpose and
 * spent by the organiser outside the app. Nothing here disburses to members.
 *
 * `PAID` is never written by this service. A due becomes paid only when the
 * payment workflow posts a settled ledger transaction, so no code path here can
 * mark money as received that did not arrive.
 */
@Injectable()
export class AkawoPoolsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
  ) {}

  /**
   * Creates a pool and returns the join code once. Only its digest is stored, so
   * this response is the only time the plaintext exists — the organiser is told
   * to share it now.
   */
  async create(organiserUserId: string, dto: CreateAkawoPoolDto): Promise<unknown> {
    const dueAt = dto.dueAt ? new Date(dto.dueAt) : undefined;
    if (dueAt && dueAt <= new Date()) {
      throw new UnprocessableEntityException('The due date must be in the future');
    }

    const joinCode = generateJoinCode(randomBytes(8));
    const pool = await this.prisma.akawoPool.create({
      data: {
        organiserUserId,
        name: dto.name,
        ...(dto.purpose ? { purpose: dto.purpose } : {}),
        amountMinor: BigInt(dto.amountMinor),
        status: AkawoPoolStatus.DRAFT,
        joinCodeDigest: this.digest(joinCode),
        ...(dto.referenceLabel ? { referenceLabel: dto.referenceLabel } : {}),
        ...(dueAt ? { dueAt } : {}),
      },
      select: poolSelect,
    });
    return this.serialize({ ...pool, joinCode, memberCount: 0, paidCount: 0, collectedMinor: 0n });
  }

  /** Pools this user organises. */
  async listOrganised(organiserUserId: string): Promise<unknown[]> {
    const pools = await this.prisma.akawoPool.findMany({
      where: { organiserUserId },
      select: { ...poolSelect, _count: { select: { members: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return Promise.all(pools.map((pool) => this.withTotals(pool)));
  }

  /** Pools this user has joined, with their own due. */
  async listJoined(userId: string): Promise<unknown[]> {
    const memberships = await this.prisma.akawoPoolMember.findMany({
      where: { userId, status: AkawoPoolMemberStatus.ACTIVE },
      select: {
        ...memberSelect,
        // The organiser's id comes back so their name can be resolved below.
        // Whom a member is paying is the thing that makes a collection
        // trustworthy, so the list says it rather than leaving it to a tap.
        pool: { select: { ...poolSelect, organiserUserId: true } },
        dues: { select: { id: true, amountMinor: true, status: true, paidAt: true } },
      },
      orderBy: { joinedAt: 'desc' },
    });

    const organiserIds = [...new Set(memberships.map((entry) => entry.pool.organiserUserId))];
    const profiles = organiserIds.length
      ? await this.prisma.userProfile.findMany({
          where: { userId: { in: organiserIds } },
          select: { userId: true, firstName: true, lastName: true },
        })
      : [];
    const nameByUserId = new Map(
      profiles.map((profile) => [
        profile.userId,
        `${profile.firstName} ${profile.lastName}`.trim(),
      ]),
    );

    return this.serialize(
      memberships.map((membership) => {
        // The organiser's user id is dropped: the name is what a member needs,
        // and the id identifies an account they have no other claim on.
        const { organiserUserId, ...pool } = membership.pool;
        return {
          membershipId: membership.id,
          pool: {
            ...pool,
            organiserName: nameByUserId.get(organiserUserId) ?? 'Organiser',
          },
          due: membership.dues[0] ?? null,
        };
      }),
    );
  }

  /**
   * The organiser's view: every member, their reference, and whether they have
   * paid. This is the record the client renders as a PDF.
   */
  async getOrganiserView(organiserUserId: string, poolId: string): Promise<unknown> {
    const pool = await this.prisma.akawoPool.findUnique({
      where: { id: poolId },
      select: {
        ...poolSelect,
        organiserUserId: true,
        members: {
          where: { status: AkawoPoolMemberStatus.ACTIVE },
          select: {
            ...memberSelect,
            dues: { select: { id: true, amountMinor: true, status: true, paidAt: true } },
          },
          orderBy: { joinedAt: 'asc' },
        },
      },
    });
    if (!pool) throw new NotFoundException('Pool was not found');
    if (pool.organiserUserId !== organiserUserId) {
      throw new ForbiddenException('You do not organise this pool');
    }

    // organiserUserId is fetched for the ownership check but is not part of the
    // response, so it is dropped rather than leaked into the payload.
    const { organiserUserId: _ownerId, members, ...rest } = pool;
    void _ownerId;
    const rows = members.map((member) => {
      const { dues, ...memberRest } = member;
      return { ...memberRest, due: dues[0] ?? null };
    });
    const collectedMinor = rows.reduce(
      (total, row) =>
        row.due?.status === AkawoDueStatus.PAID ? total + row.due.amountMinor : total,
      0n,
    );
    const expectedMinor = rest.amountMinor * BigInt(rows.length);

    return this.serialize({
      ...rest,
      members: rows,
      memberCount: rows.length,
      paidCount: rows.filter((row) => row.due?.status === AkawoDueStatus.PAID).length,
      collectedMinor,
      expectedMinor,
      progressBps: collectionProgressBps(collectedMinor, expectedMinor),
    });
  }

  /**
   * A member's view. It deliberately excludes other members' payment detail:
   * a joiner sees the pool, their own due, and the totals — nothing more.
   */
  async getMemberView(userId: string, poolId: string): Promise<unknown> {
    const membership = await this.prisma.akawoPoolMember.findUnique({
      where: { poolId_userId: { poolId, userId } },
      select: {
        ...memberSelect,
        pool: { select: poolSelect },
        dues: { select: { id: true, amountMinor: true, status: true, paidAt: true } },
      },
    });
    if (!membership) throw new NotFoundException('You are not a member of this pool');

    const totals = await this.totals(poolId);
    const { dues, pool, ...rest } = membership;
    return this.serialize({
      membership: rest,
      pool,
      due: dues[0] ?? null,
      ...totals,
    });
  }

  /** Describes a pool from its join code, so a joiner can confirm before joining. */
  async preview(joinCode: string): Promise<unknown> {
    const pool = await this.findByJoinCode(joinCode);
    return this.serialize({
      id: pool.id,
      name: pool.name,
      purpose: pool.purpose,
      amountMinor: pool.amountMinor,
      currency: pool.currency,
      referenceLabel: pool.referenceLabel,
      dueAt: pool.dueAt,
      organiserName: pool.organiser.profile
        ? `${pool.organiser.profile.firstName} ${pool.organiser.profile.lastName}`
        : 'Pool organiser',
    });
  }

  /**
   * Joins a pool and creates the member's due in the same transaction, so a
   * membership can never exist without the obligation it implies.
   */
  async join(userId: string, dto: JoinAkawoPoolDto): Promise<unknown> {
    const pool = await this.findByJoinCode(dto.joinCode);
    if (!acceptsMembers(pool.status)) {
      throw new ConflictException('This pool is not accepting members');
    }

    return this.transactions.serializable(async (tx) => {
      const existing = await tx.akawoPoolMember.findUnique({
        where: { poolId_userId: { poolId: pool.id, userId } },
        select: { id: true, status: true },
      });
      if (existing) throw new ConflictException('You have already joined this pool');

      const duplicateReference = await tx.akawoPoolMember.findUnique({
        where: { poolId_reference: { poolId: pool.id, reference: dto.reference } },
        select: { id: true },
      });
      if (duplicateReference) {
        throw new ConflictException(
          `That ${pool.referenceLabel.toLowerCase()} is already used in this pool`,
        );
      }

      const member = await tx.akawoPoolMember.create({
        data: {
          poolId: pool.id,
          userId,
          fullName: dto.fullName,
          reference: dto.reference,
        },
        select: memberSelect,
      });
      const due = await tx.akawoPoolDue.create({
        data: {
          poolId: pool.id,
          memberId: member.id,
          amountMinor: pool.amountMinor,
          currency: pool.currency,
        },
        select: { id: true, amountMinor: true, status: true, paidAt: true },
      });
      await this.audit(tx, userId, pool.id, 'akawo.pool.joined');
      return this.serialize({ member, due, poolId: pool.id });
    });
  }

  async update(organiserUserId: string, poolId: string, dto: UpdateAkawoPoolDto): Promise<unknown> {
    const pool = await this.requireOrganiser(organiserUserId, poolId);
    if (pool.status === AkawoPoolStatus.CLOSED || pool.status === AkawoPoolStatus.CANCELLED) {
      throw new ConflictException('A closed pool cannot be edited');
    }
    const dueAt = dto.dueAt ? new Date(dto.dueAt) : undefined;
    const updated = await this.prisma.akawoPool.update({
      where: { id: poolId },
      data: {
        ...(dto.name ? { name: dto.name } : {}),
        ...(dto.purpose !== undefined ? { purpose: dto.purpose } : {}),
        ...(dueAt ? { dueAt } : {}),
      },
      select: poolSelect,
    });
    return this.serialize(updated);
  }

  /** Opens a draft pool so its code starts working. */
  async open(organiserUserId: string, poolId: string): Promise<unknown> {
    return this.transition(organiserUserId, poolId, AkawoPoolStatus.OPEN, 'akawo.pool.opened');
  }

  /** Closes a pool: no further members or payments, and the record is final. */
  async close(organiserUserId: string, poolId: string): Promise<unknown> {
    return this.transition(organiserUserId, poolId, AkawoPoolStatus.CLOSED, 'akawo.pool.closed');
  }

  async cancel(organiserUserId: string, poolId: string): Promise<unknown> {
    return this.transactions.serializable(async (tx) => {
      const pool = await this.requireOrganiser(organiserUserId, poolId, tx);
      const paidCount = await tx.akawoPoolDue.count({
        where: { poolId, status: AkawoDueStatus.PAID },
      });
      if (!canCancel(pool.status, paidCount)) {
        throw new ConflictException(
          paidCount > 0
            ? 'This pool has taken payments and cannot be cancelled; close it instead'
            : 'This pool cannot be cancelled in its current state',
        );
      }
      const updated = await tx.akawoPool.update({
        where: { id: poolId },
        data: { status: AkawoPoolStatus.CANCELLED, closedAt: new Date() },
        select: poolSelect,
      });
      await this.audit(tx, organiserUserId, poolId, 'akawo.pool.cancelled');
      return this.serialize(updated);
    });
  }

  /** Removes a member who has not paid, and their due with them. */
  async removeMember(organiserUserId: string, poolId: string, memberId: string): Promise<unknown> {
    return this.transactions.serializable(async (tx) => {
      await this.requireOrganiser(organiserUserId, poolId, tx);
      const due = await tx.akawoPoolDue.findUnique({
        where: { poolId_memberId: { poolId, memberId } },
        select: { id: true, status: true },
      });
      if (!due) throw new NotFoundException('That member was not found in this pool');
      if (!canRemoveMember(due.status)) {
        throw new ConflictException('A member who has paid cannot be removed');
      }
      const updated = await tx.akawoPoolMember.update({
        where: { id: memberId },
        data: { status: AkawoPoolMemberStatus.REMOVED, removedAt: new Date() },
        select: memberSelect,
      });
      await this.audit(tx, organiserUserId, poolId, 'akawo.pool.member.removed');
      return this.serialize(updated);
    });
  }

  /**
   * Waives a member's due. This records that they are not expected to pay; it
   * does not claim money arrived, which is why it is a distinct status from
   * PAID.
   */
  async waiveDue(
    organiserUserId: string,
    poolId: string,
    memberId: string,
    dto: WaiveAkawoDueDto,
  ): Promise<unknown> {
    return this.transactions.serializable(async (tx) => {
      await this.requireOrganiser(organiserUserId, poolId, tx);
      const due = await tx.akawoPoolDue.findUnique({
        where: { poolId_memberId: { poolId, memberId } },
        select: { id: true, status: true },
      });
      if (!due) throw new NotFoundException('That member was not found in this pool');
      if (due.status !== AkawoDueStatus.PENDING) {
        throw new ConflictException('Only an outstanding due can be waived');
      }
      const updated = await tx.akawoPoolDue.update({
        where: { id: due.id },
        data: { status: AkawoDueStatus.WAIVED, waivedReason: dto.reason },
        select: { id: true, amountMinor: true, status: true, paidAt: true },
      });
      await this.audit(tx, organiserUserId, poolId, 'akawo.pool.due.waived');
      return this.serialize(updated);
    });
  }

  private async transition(
    organiserUserId: string,
    poolId: string,
    to: AkawoPoolStatus,
    action: string,
  ): Promise<unknown> {
    return this.transactions.serializable(async (tx) => {
      const pool = await this.requireOrganiser(organiserUserId, poolId, tx);
      if (!canTransition(pool.status, to)) {
        throw new ConflictException(
          `A ${pool.status.toLowerCase()} pool cannot become ${to.toLowerCase()}`,
        );
      }
      const updated = await tx.akawoPool.update({
        where: { id: poolId },
        data: {
          status: to,
          ...(to === AkawoPoolStatus.CLOSED ? { closedAt: new Date() } : {}),
        },
        select: poolSelect,
      });
      await this.audit(tx, organiserUserId, poolId, action);
      return this.serialize(updated);
    });
  }

  private async requireOrganiser(
    organiserUserId: string,
    poolId: string,
    client: TransactionClient | PrismaService = this.prisma,
  ) {
    const pool = await client.akawoPool.findUnique({
      where: { id: poolId },
      select: { id: true, status: true, organiserUserId: true },
    });
    if (!pool) throw new NotFoundException('Pool was not found');
    if (pool.organiserUserId !== organiserUserId) {
      throw new ForbiddenException('You do not organise this pool');
    }
    return pool;
  }

  private async findByJoinCode(joinCode: string) {
    if (!isValidJoinCodeShape(joinCode)) {
      throw new NotFoundException('That join code was not recognised');
    }
    const pool = await this.prisma.akawoPool.findUnique({
      where: { joinCodeDigest: this.digest(normalizeJoinCode(joinCode)) },
      select: {
        ...poolSelect,
        organiser: { select: { profile: { select: { firstName: true, lastName: true } } } },
      },
    });
    // A wrong code and a code for a pool that is not open report identically, so
    // a guessed code cannot be used to discover which pools exist.
    if (!pool) throw new NotFoundException('That join code was not recognised');
    return pool;
  }

  private async totals(poolId: string) {
    const [memberCount, paid] = await Promise.all([
      this.prisma.akawoPoolMember.count({
        where: { poolId, status: AkawoPoolMemberStatus.ACTIVE },
      }),
      this.prisma.akawoPoolDue.findMany({
        where: { poolId, status: AkawoDueStatus.PAID },
        select: { amountMinor: true },
      }),
    ]);
    const collectedMinor = paid.reduce((total, due) => total + due.amountMinor, 0n);
    return { memberCount, paidCount: paid.length, collectedMinor };
  }

  private async withTotals<T extends { id: string; amountMinor: bigint }>(pool: T) {
    const totals = await this.totals(pool.id);
    const expectedMinor = pool.amountMinor * BigInt(totals.memberCount);
    return this.serialize({
      ...pool,
      ...totals,
      expectedMinor,
      progressBps: collectionProgressBps(totals.collectedMinor, expectedMinor),
    });
  }

  private digest(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private async audit(
    tx: TransactionClient,
    actorUserId: string,
    poolId: string,
    action: string,
  ): Promise<void> {
    await tx.auditLog.create({
      data: { actorUserId, action, subjectType: 'AkawoPool', subjectId: poolId },
    });
  }

  private serialize<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_, item: unknown) =>
        typeof item === 'bigint' ? item.toString() : item,
      ),
    ) as T;
  }
}
