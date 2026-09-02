import { createHash, randomBytes } from 'node:crypto';
import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  FoodAjoStatus,
  FoodDistributionStatus,
  FoodSubscriptionStatus,
  PurchaseOrderStatus,
} from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import {
  TransactionService,
  type TransactionClient,
} from '../../infrastructure/database/transaction.service.js';
import {
  COLLECTION_CODE_TTL_MS,
  assertCanCompleteProgramme,
  assertCanConfirmCollection,
  assertCanOpenProgramme,
  assertCanPlanDistribution,
  assertCanProcure,
  assertPackageEditable,
  assertVendorUsable,
  canTransitionDistribution,
  canTransitionProgramme,
  canTransitionPurchaseOrder,
  generateCollectionCode,
  isValidCollectionCodeShape,
  normalizeCollectionCode,
  purchaseOrderTotalMinor,
} from './domain/food-ajo-policy.js';
import type {
  ConfirmCollectionDto,
  CreateDistributionDto,
  CreatePurchaseOrderDto,
  CreateVendorDto,
  RecordReceiptDto,
  TransitionDistributionDto,
  TransitionProgrammeDto,
  TransitionPurchaseOrderDto,
  UpdateFoodPackageDto,
} from './dto/coordinator.dto.js';

/** Subscription states that represent a real, live claim on the programme. */
const LIVE_SUBSCRIPTIONS = [FoodSubscriptionStatus.PENDING, FoodSubscriptionStatus.ACTIVE] as const;

const orderSelect = {
  id: true,
  vendorId: true,
  foodAjoGroupId: true,
  internalReference: true,
  status: true,
  totalMinor: true,
  currency: true,
  createdAt: true,
  items: { select: { id: true, description: true, quantity: true, unitPriceMinor: true } },
  vendor: { select: { id: true, name: true, isVerified: true } },
  receipts: { select: { id: true, receivedAt: true, createdAt: true } },
} as const;

const distributionSelect = {
  id: true,
  groupId: true,
  status: true,
  scheduledAt: true,
  completedAt: true,
  createdAt: true,
  items: {
    select: {
      id: true,
      subscriptionId: true,
      quantity: true,
      confirmation: { select: { id: true, confirmedAt: true, usedAt: true, expiresAt: true } },
    },
  },
} as const;

/** A programme loaded through the coordinator ownership check. */
interface OwnedProgramme {
  readonly id: string;
  readonly coordinatorUserId: string;
  readonly status: FoodAjoStatus;
  readonly currency: string;
  readonly enrolmentCapacity: number;
  readonly activatedAt: Date | null;
  readonly packages: readonly { id: string; priceMinor: bigint; isActive: boolean }[];
}

/**
 * Everything a Food Ajo coordinator does after a programme exists: opening it
 * for enrolment, ordering from vendors, and handing the food out.
 *
 * Kept separate from the member-facing programme service because the two have
 * opposite authorisation: every route here is owner-scoped to the coordinator
 * of the programme, and none of them may be reached by a subscriber.
 */
@Injectable()
export class FoodAjoCoordinatorService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly transactions: TransactionService,
  ) {}

  /**
   * Moves a programme through its lifecycle.
   *
   * Opening is the moment package prices are locked: a member enrols against a
   * displayed price, so it must stop being editable before anybody can see it.
   */
  async transitionProgramme(
    userId: string,
    programmeId: string,
    dto: TransitionProgrammeDto,
  ): Promise<unknown> {
    const updated = await this.transactions.serializable(async (tx) => {
      const programme = await this.ownedProgramme(tx, userId, programmeId);

      if (dto.status === FoodAjoStatus.OPEN && programme.status === FoodAjoStatus.DRAFT) {
        assertCanOpenProgramme({
          status: programme.status,
          packages: programme.packages,
          enrolmentCapacity: programme.enrolmentCapacity,
        });
      } else if (dto.status === FoodAjoStatus.COMPLETED) {
        assertCanCompleteProgramme({
          status: programme.status,
          outstandingCollections: await this.outstandingCollections(tx, programmeId),
        });
      } else if (!canTransitionProgramme(programme.status, dto.status)) {
        throw new ConflictException(
          `A ${programme.status.toLowerCase()} programme cannot become ${dto.status.toLowerCase()}`,
        );
      }

      const now = new Date();
      const result = await tx.foodAjoGroup.update({
        where: { id: programmeId },
        data: {
          status: dto.status,
          // Stamped on the first activation only: resuming a suspended
          // programme must not rewrite when it originally went live.
          ...(dto.status === FoodAjoStatus.ACTIVE && !programme.activatedAt
            ? { activatedAt: now }
            : {}),
        },
        select: {
          id: true,
          status: true,
          activatedAt: true,
          enrolmentCapacity: true,
          distributionAt: true,
        },
      });

      // Locking prices at the point of opening, not at creation: a draft is
      // still being worked on, and an unopened programme has no members to
      // protect. Once open, the price a member saw is the price they owe.
      if (dto.status === FoodAjoStatus.OPEN) {
        await tx.foodPackage.updateMany({
          where: { groupId: programmeId, priceLockedAt: null },
          data: { priceLockedAt: now },
        });
      }

      await this.audit(tx, userId, `food.programme.${dto.status.toLowerCase()}`, programmeId, {
        from: programme.status,
        to: dto.status,
        ...(dto.reason ? { reason: dto.reason } : {}),
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'FoodAjoGroup',
          aggregateId: programmeId,
          eventType: `food.programme.${dto.status.toLowerCase()}`,
          payload: { programmeId, from: programme.status, to: dto.status },
        },
      });
      return result;
    });
    return this.serialize(updated);
  }

  /** Edits a package while the programme is still a private draft. */
  async updatePackage(
    userId: string,
    programmeId: string,
    packageId: string,
    dto: UpdateFoodPackageDto,
  ): Promise<unknown> {
    const updated = await this.transactions.serializable(async (tx) => {
      const programme = await this.ownedProgramme(tx, userId, programmeId);
      const foodPackage = await tx.foodPackage.findUnique({
        where: { id: packageId },
        select: { id: true, groupId: true, priceLockedAt: true },
      });
      if (!foodPackage || foodPackage.groupId !== programmeId) {
        throw new NotFoundException('That package was not found in this programme');
      }
      assertPackageEditable({
        programmeStatus: programme.status,
        priceLockedAt: foodPackage.priceLockedAt,
      });

      const result = await tx.foodPackage.update({
        where: { id: packageId },
        data: {
          ...(dto.name ? { name: dto.name } : {}),
          ...(dto.priceMinor ? { priceMinor: BigInt(dto.priceMinor) } : {}),
        },
        select: { id: true, name: true, priceMinor: true, priceLockedAt: true, isActive: true },
      });
      await this.audit(tx, userId, 'food.package.updated', packageId, { programmeId });
      return result;
    });
    return this.serialize(updated);
  }

  /**
   * What the coordinator needs in order to buy: how many portions of each
   * package were actually taken.
   *
   * Deliberately counts enrolments rather than capacity. Ordering to capacity
   * would spend contributions that were never collected on food nobody claimed.
   */
  async procurementPlan(userId: string, programmeId: string): Promise<unknown> {
    await this.ownedProgramme(this.prisma, userId, programmeId);
    const [programme, byPackage] = await Promise.all([
      this.prisma.foodAjoGroup.findUniqueOrThrow({
        where: { id: programmeId },
        select: { id: true, name: true, status: true, currency: true, enrolmentCapacity: true },
      }),
      this.prisma.foodSubscription.groupBy({
        by: ['packageId'],
        where: { groupId: programmeId, status: { in: [...LIVE_SUBSCRIPTIONS] } },
        _sum: { quantity: true },
        _count: { _all: true },
      }),
    ]);

    const packages = await this.prisma.foodPackage.findMany({
      where: { groupId: programmeId },
      select: {
        id: true,
        name: true,
        priceMinor: true,
        isActive: true,
        items: { select: { name: true, quantity: true, unit: true } },
      },
    });

    const lines = packages.map((foodPackage) => {
      const enrolment = byPackage.find((row) => row.packageId === foodPackage.id);
      const portions = enrolment?._sum.quantity ?? 0;
      return {
        packageId: foodPackage.id,
        name: foodPackage.name,
        priceMinor: foodPackage.priceMinor,
        subscribers: enrolment?._count._all ?? 0,
        portions,
        // What the members owe for this package, which is the ceiling for what
        // may sensibly be spent procuring it.
        expectedMinor: foodPackage.priceMinor * BigInt(portions),
        // Aggregate shopping list: each item's quantity multiplied by portions.
        items: foodPackage.items.map((item) => ({
          name: item.name,
          unit: item.unit,
          unitQuantity: item.quantity.toString(),
          totalQuantity: (Number(item.quantity) * portions).toFixed(3),
        })),
      };
    });

    return this.serialize({
      programme,
      totalPortions: lines.reduce((sum, line) => sum + line.portions, 0),
      expectedMinor: lines.reduce((sum, line) => sum + line.expectedMinor, 0n),
      packages: lines,
    });
  }

  /** Registers a purchase order against an approved vendor. */
  async createPurchaseOrder(
    userId: string,
    programmeId: string,
    dto: CreatePurchaseOrderDto,
  ): Promise<unknown> {
    const created = await this.transactions.serializable(async (tx) => {
      const programme = await this.ownedProgramme(tx, userId, programmeId);
      const portions = await tx.foodSubscription.aggregate({
        where: { groupId: programmeId, status: { in: [...LIVE_SUBSCRIPTIONS] } },
        _sum: { quantity: true },
      });
      assertCanProcure({
        status: programme.status,
        subscribedPortions: portions._sum.quantity ?? 0,
      });

      const vendor = await tx.vendor.findUnique({
        where: { id: dto.vendorId },
        select: { id: true, isVerified: true },
      });
      assertVendorUsable({ exists: Boolean(vendor), isVerified: vendor?.isVerified === true });

      const items = dto.items.map((item) => ({
        description: item.description,
        quantity: item.quantity,
        unitPriceMinor: BigInt(item.unitPriceMinor),
      }));
      const order = await tx.purchaseOrder.create({
        data: {
          vendorId: dto.vendorId,
          foodAjoGroupId: programmeId,
          internalReference: this.reference('PO'),
          totalMinor: purchaseOrderTotalMinor(items),
          currency: programme.currency,
          items: { create: items },
        },
        select: orderSelect,
      });
      await this.audit(tx, userId, 'food.purchase-order.created', order.id, { programmeId });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'PurchaseOrder',
          aggregateId: order.id,
          eventType: 'food.purchase-order.created',
          payload: { programmeId, purchaseOrderId: order.id },
        },
      });
      return order;
    });
    return this.serialize(created);
  }

  async listPurchaseOrders(userId: string, programmeId: string): Promise<unknown> {
    await this.ownedProgramme(this.prisma, userId, programmeId);
    const orders = await this.prisma.purchaseOrder.findMany({
      where: { foodAjoGroupId: programmeId },
      select: orderSelect,
      orderBy: { createdAt: 'desc' },
    });
    return this.serialize(orders);
  }

  async transitionPurchaseOrder(
    userId: string,
    programmeId: string,
    orderId: string,
    dto: TransitionPurchaseOrderDto,
  ): Promise<unknown> {
    const updated = await this.transactions.serializable(async (tx) => {
      await this.ownedProgramme(tx, userId, programmeId);
      const order = await tx.purchaseOrder.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          status: true,
          foodAjoGroupId: true,
          _count: { select: { receipts: true } },
        },
      });
      if (!order || order.foodAjoGroupId !== programmeId) {
        throw new NotFoundException('That purchase order was not found in this programme');
      }
      if (!canTransitionPurchaseOrder(order.status, dto.status)) {
        throw new ConflictException(
          `A ${order.status.toLowerCase()} order cannot become ${dto.status.toLowerCase()}`,
        );
      }
      // Fulfilment is a claim that goods arrived. Requiring the receipt first
      // means that claim always has evidence behind it.
      if (dto.status === PurchaseOrderStatus.FULFILLED && order._count.receipts === 0) {
        throw new UnprocessableEntityException(
          'Record the delivery receipt before marking this order fulfilled',
        );
      }

      const result = await tx.purchaseOrder.update({
        where: { id: orderId },
        data: { status: dto.status },
        select: orderSelect,
      });
      await this.audit(tx, userId, `food.purchase-order.${dto.status.toLowerCase()}`, orderId, {
        programmeId,
        from: order.status,
      });
      return result;
    });
    return this.serialize(updated);
  }

  /**
   * Records that goods were received, by storage key and content hash only.
   *
   * The document itself never passes through this route: persisting the hash is
   * what makes the evidence tamper-evident later.
   */
  async recordReceipt(
    userId: string,
    programmeId: string,
    orderId: string,
    dto: RecordReceiptDto,
  ): Promise<unknown> {
    const created = await this.transactions.serializable(async (tx) => {
      await this.ownedProgramme(tx, userId, programmeId);
      const order = await tx.purchaseOrder.findUnique({
        where: { id: orderId },
        select: { id: true, status: true, foodAjoGroupId: true },
      });
      if (!order || order.foodAjoGroupId !== programmeId) {
        throw new NotFoundException('That purchase order was not found in this programme');
      }
      if (order.status !== PurchaseOrderStatus.CONFIRMED) {
        throw new ConflictException('Only a confirmed order can take a delivery receipt');
      }
      const receipt = await tx.purchaseReceipt.create({
        data: {
          purchaseOrderId: orderId,
          storageKey: dto.storageKey,
          contentHash: dto.contentHash,
          receivedAt: new Date(dto.receivedAt),
        },
        select: { id: true, purchaseOrderId: true, receivedAt: true, createdAt: true },
      });
      await this.audit(tx, userId, 'food.purchase-receipt.recorded', receipt.id, {
        programmeId,
        purchaseOrderId: orderId,
      });
      return receipt;
    });
    return this.serialize(created);
  }

  /**
   * Plans a distribution and enrols every live subscription into it.
   *
   * The item list is built server-side from the subscriptions rather than taken
   * from the client, so a coordinator cannot quietly leave a member out of the
   * hand-out they paid for.
   */
  async createDistribution(
    userId: string,
    programmeId: string,
    dto: CreateDistributionDto,
  ): Promise<unknown> {
    const created = await this.transactions.serializable(async (tx) => {
      const programme = await this.ownedProgramme(tx, userId, programmeId);
      const fulfilled = await tx.purchaseOrder.count({
        where: { foodAjoGroupId: programmeId, status: PurchaseOrderStatus.FULFILLED },
      });
      assertCanPlanDistribution({
        programmeStatus: programme.status,
        fulfilledOrders: fulfilled,
        scheduledAt: new Date(dto.scheduledAt),
        now: new Date(),
      });

      const subscriptions = await tx.foodSubscription.findMany({
        where: { groupId: programmeId, status: { in: [...LIVE_SUBSCRIPTIONS] } },
        select: { id: true, quantity: true },
      });
      if (subscriptions.length === 0) {
        throw new UnprocessableEntityException('There are no enrolments to distribute to');
      }

      const distribution = await tx.foodDistribution.create({
        data: {
          groupId: programmeId,
          scheduledAt: new Date(dto.scheduledAt),
          items: {
            create: subscriptions.map((subscription) => ({
              subscriptionId: subscription.id,
              quantity: subscription.quantity,
            })),
          },
        },
        select: distributionSelect,
      });
      await this.audit(tx, userId, 'food.distribution.planned', distribution.id, {
        programmeId,
        items: subscriptions.length,
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'FoodDistribution',
          aggregateId: distribution.id,
          eventType: 'food.distribution.planned',
          payload: { programmeId, distributionId: distribution.id },
        },
      });
      return distribution;
    });
    return this.serialize(created);
  }

  async listDistributions(userId: string, programmeId: string): Promise<unknown> {
    await this.ownedProgramme(this.prisma, userId, programmeId);
    const distributions = await this.prisma.foodDistribution.findMany({
      where: { groupId: programmeId },
      select: distributionSelect,
      orderBy: { scheduledAt: 'desc' },
    });
    return this.serialize(distributions);
  }

  async transitionDistribution(
    userId: string,
    programmeId: string,
    distributionId: string,
    dto: TransitionDistributionDto,
  ): Promise<unknown> {
    const updated = await this.transactions.serializable(async (tx) => {
      await this.ownedProgramme(tx, userId, programmeId);
      const distribution = await tx.foodDistribution.findUnique({
        where: { id: distributionId },
        select: { id: true, groupId: true, status: true },
      });
      if (!distribution || distribution.groupId !== programmeId) {
        throw new NotFoundException('That distribution was not found in this programme');
      }
      if (!canTransitionDistribution(distribution.status, dto.status)) {
        throw new ConflictException(
          `A ${distribution.status.toLowerCase()} distribution cannot become ${dto.status.toLowerCase()}`,
        );
      }
      if (dto.status === FoodDistributionStatus.COMPLETED) {
        const outstanding = await tx.foodDistributionItem.count({
          where: { distributionId, confirmation: { is: null } },
        });
        if (outstanding > 0) {
          throw new ConflictException(
            `${outstanding} members have not collected yet; record or cancel their items first`,
          );
        }
      }

      const result = await tx.foodDistribution.update({
        where: { id: distributionId },
        data: {
          status: dto.status,
          ...(dto.status === FoodDistributionStatus.COMPLETED ? { completedAt: new Date() } : {}),
        },
        select: distributionSelect,
      });
      await this.audit(
        tx,
        userId,
        `food.distribution.${dto.status.toLowerCase()}`,
        distributionId,
        {
          programmeId,
          from: distribution.status,
        },
      );
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'FoodDistribution',
          aggregateId: distributionId,
          eventType: `food.distribution.${dto.status.toLowerCase()}`,
          payload: { programmeId, distributionId, to: dto.status },
        },
      });
      return result;
    });
    return this.serialize(updated);
  }

  /**
   * Issues the one-time code a member presents to collect their food.
   *
   * Called by the member for their own item, never by the coordinator: a
   * coordinator who could mint and redeem codes could mark food as collected
   * that nobody ever received, which is precisely what this evidence exists to
   * rule out. Only the digest is stored, so the database never holds a usable
   * set of collection codes.
   */
  async issueCollectionCode(userId: string, distributionId: string): Promise<unknown> {
    const code = generateCollectionCode(randomBytes(6));
    const issued = await this.transactions.serializable(async (tx) => {
      const distribution = await tx.foodDistribution.findUnique({
        where: { id: distributionId },
        select: { id: true, groupId: true, status: true, scheduledAt: true },
      });
      if (!distribution) throw new NotFoundException('That distribution was not found');

      const subscription = await tx.foodSubscription.findFirst({
        where: {
          groupId: distribution.groupId,
          userId,
          status: { in: [...LIVE_SUBSCRIPTIONS] },
        },
        select: { id: true },
      });
      if (!subscription) throw new NotFoundException('You are not enrolled in this programme');

      const item = await tx.foodDistributionItem.findUnique({
        where: {
          distributionId_subscriptionId: { distributionId, subscriptionId: subscription.id },
        },
        select: { id: true, confirmation: { select: { id: true, usedAt: true } } },
      });
      if (!item) throw new NotFoundException('You have no item in this distribution');
      if (item.confirmation?.usedAt) {
        throw new ConflictException('You have already collected this item');
      }
      if (
        distribution.status !== FoodDistributionStatus.READY &&
        distribution.status !== FoodDistributionStatus.DISTRIBUTING
      ) {
        throw new ConflictException('This distribution is not ready for collection yet');
      }

      const expiresAt = new Date(Date.now() + COLLECTION_CODE_TTL_MS);
      // Re-issuing replaces the previous code, so a member who lost theirs is
      // not locked out, and the code they lost stops working.
      await tx.distributionConfirmation.upsert({
        where: { distributionItemId: item.id },
        create: {
          distributionItemId: item.id,
          confirmedByUserId: userId,
          confirmationHash: this.digest(code),
          expiresAt,
        },
        update: { confirmationHash: this.digest(code), expiresAt, confirmedByUserId: userId },
      });
      await this.audit(tx, userId, 'food.collection.code-issued', item.id, {
        distributionId,
      });
      return { distributionItemId: item.id, expiresAt };
    });
    // The code is returned once and never stored in the clear.
    return this.serialize({ ...issued, code });
  }

  /**
   * Confirms that a member collected their food, against the code they present.
   *
   * The code is matched by digest and burnt on use, so a screenshot of an old
   * code cannot be replayed to collect twice.
   */
  async confirmCollection(
    userId: string,
    programmeId: string,
    distributionId: string,
    dto: ConfirmCollectionDto,
  ): Promise<unknown> {
    if (!isValidCollectionCodeShape(dto.code)) {
      throw new UnprocessableEntityException('That collection code is not valid');
    }
    const confirmed = await this.transactions.serializable(async (tx) => {
      await this.ownedProgramme(tx, userId, programmeId);
      const distribution = await tx.foodDistribution.findUnique({
        where: { id: distributionId },
        select: { id: true, groupId: true, status: true },
      });
      if (!distribution || distribution.groupId !== programmeId) {
        throw new NotFoundException('That distribution was not found in this programme');
      }

      const confirmation = await tx.distributionConfirmation.findFirst({
        where: {
          confirmationHash: this.digest(normalizeCollectionCode(dto.code)),
          item: { distributionId },
        },
        select: { id: true, usedAt: true, expiresAt: true, distributionItemId: true },
      });
      // A wrong code and an expired one are reported the same way: telling a
      // caller which of the two it was would let them probe for live codes.
      if (!confirmation || confirmation.expiresAt <= new Date()) {
        throw new UnprocessableEntityException('That collection code is not valid');
      }
      assertCanConfirmCollection({
        distributionStatus: distribution.status,
        alreadyConfirmed: Boolean(confirmation.usedAt),
      });

      const result = await tx.distributionConfirmation.update({
        where: { id: confirmation.id },
        data: {
          usedAt: new Date(),
          ...(dto.evidenceStorageKey ? { evidenceStorageKey: dto.evidenceStorageKey } : {}),
        },
        select: { id: true, distributionItemId: true, usedAt: true },
      });
      await this.audit(tx, userId, 'food.collection.confirmed', confirmation.distributionItemId, {
        programmeId,
        distributionId,
      });
      await tx.outboxEvent.create({
        data: {
          aggregateType: 'FoodDistributionItem',
          aggregateId: confirmation.distributionItemId,
          eventType: 'food.collection.confirmed',
          payload: { programmeId, distributionId },
        },
      });
      return result;
    });
    return this.serialize(confirmed);
  }

  /** Vendors available to order from. */
  async listVendors(): Promise<unknown> {
    const vendors = await this.prisma.vendor.findMany({
      where: { isVerified: true },
      select: { id: true, name: true, contactEmail: true, contactPhone: true, isVerified: true },
      orderBy: { name: 'asc' },
    });
    return this.serialize(vendors);
  }

  /**
   * Proposes a vendor. It is created unverified on purpose: verification is a
   * platform decision, so a coordinator cannot approve their own supplier and
   * then order from it.
   */
  async proposeVendor(userId: string, dto: CreateVendorDto): Promise<unknown> {
    const vendor = await this.prisma.vendor.create({
      data: {
        name: dto.name,
        ...(dto.contactEmail ? { contactEmail: dto.contactEmail } : {}),
        ...(dto.contactPhone ? { contactPhone: dto.contactPhone } : {}),
      },
      select: { id: true, name: true, isVerified: true, createdAt: true },
    });
    await this.prisma.auditLog.create({
      data: {
        actorUserId: userId,
        action: 'food.vendor.proposed',
        subjectType: 'Vendor',
        subjectId: vendor.id,
      },
    });
    return this.serialize(vendor);
  }

  /** Members who are still owed food across every live distribution. */
  private async outstandingCollections(
    tx: TransactionClient,
    programmeId: string,
  ): Promise<number> {
    return tx.foodDistributionItem.count({
      where: {
        distribution: {
          groupId: programmeId,
          status: { notIn: [FoodDistributionStatus.CANCELLED] },
        },
        confirmation: { is: null },
      },
    });
  }

  /**
   * Loads a programme only if this user coordinates it.
   *
   * Reports a missing programme rather than a forbidden one when the caller is
   * not the coordinator, so the route cannot be used to discover that a
   * programme exists.
   */
  private async ownedProgramme(
    client: PrismaService | TransactionClient,
    userId: string,
    programmeId: string,
  ): Promise<OwnedProgramme> {
    const programme = await client.foodAjoGroup.findUnique({
      where: { id: programmeId },
      select: {
        id: true,
        coordinatorUserId: true,
        status: true,
        currency: true,
        enrolmentCapacity: true,
        activatedAt: true,
        packages: { select: { id: true, priceMinor: true, isActive: true } },
      },
    });
    if (!programme) throw new NotFoundException('Food Ajo programme was not found');
    if (programme.coordinatorUserId !== userId) {
      throw new NotFoundException('Food Ajo programme was not found');
    }
    return programme;
  }

  private async audit(
    tx: TransactionClient,
    actorUserId: string,
    action: string,
    subjectId: string,
    metadata?: Record<string, unknown>,
  ): Promise<void> {
    await tx.auditLog.create({
      data: {
        actorUserId,
        action,
        subjectType: 'FoodAjo',
        subjectId,
        ...(metadata ? { metadata: metadata as never } : {}),
      },
    });
  }

  /** Human-traceable reference. Random rather than sequential so it does not
      leak how many orders the platform has placed. */
  private reference(prefix: string): string {
    return `${prefix}-${randomBytes(8).toString('hex').toUpperCase()}`;
  }

  private digest(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }

  private serialize<T>(value: T): T {
    return JSON.parse(
      JSON.stringify(value, (_, item: unknown) =>
        typeof item === 'bigint' ? item.toString() : item,
      ),
    ) as T;
  }
}
