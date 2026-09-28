import { ExecutionContext, ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { GUARDS_METADATA } from '@nestjs/common/constants.js';
import { Reflector } from '@nestjs/core';
import { AjoGroupsController } from '../../ajo-groups/ajo-groups.controller.js';
import { AkawoPoolsController } from '../../akawo/akawo-pools.controller.js';
import { AkawoController } from '../../akawo/akawo.controller.js';
import { FoodAjoProgrammesController } from '../../food-ajo/food-ajo-programmes.controller.js';
import { FoodCoordinatorApplicationsController } from '../../food-coordinator-applications/food-coordinator-applications.controller.js';
import { PaymentsController } from '../../payments/payments.controller.js';
import { WalletsController } from '../../wallets/wallets.controller.js';
import { KYC_ACTION_KEY, KycStageGuard } from './kyc-stage.guard.js';

type Handler = (...args: never[]) => unknown;

/** A route handler off its controller, the way Nest reads its metadata. */
function handlerOf(controller: object, method: string): Handler {
  const handler = (controller as { prototype: Record<string, Handler | undefined> }).prototype[
    method
  ];
  if (!handler) throw new Error(`${method} is not a route on this controller`);
  return handler;
}

function contextFor(handler: Handler, user?: { userId: string }): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => Object,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function prismaWith(user: unknown) {
  return { user: { findUnique: jest.fn().mockResolvedValue(user) } };
}

const stage1User = {
  status: 'ACTIVE',
  profile: {
    firstName: 'Ada',
    lastName: 'Okafor',
    dateOfBirth: new Date('1995-01-01'),
    gender: 'FEMALE',
    occupation: 'Trader',
  },
  transactionPin: null,
  kycProfile: null,
};

describe('KycStageGuard', () => {
  const withdraw = handlerOf(WalletsController, 'withdraw');
  const join = handlerOf(AjoGroupsController, 'join');

  it('lets through a caller who has reached the stage', async () => {
    const guard = new KycStageGuard(new Reflector(), prismaWith(stage1User) as never);
    await expect(guard.canActivate(contextFor(join, { userId: 'u1' }))).resolves.toBe(true);
  });

  it('refuses with the stage the action needs', async () => {
    const guard = new KycStageGuard(new Reflector(), prismaWith(stage1User) as never);
    const refusal = guard.canActivate(contextFor(withdraw, { userId: 'u1' }));
    await expect(refusal).rejects.toBeInstanceOf(ForbiddenException);
    await expect(refusal).rejects.toMatchObject({
      response: {
        code: 'KYC_STAGE_REQUIRED',
        details: { action: 'withdrawal', requiredStage: 2, completedStages: 1 },
      },
    });
  });

  it('refuses someone who has not finished stage 1 even the joining', async () => {
    const guard = new KycStageGuard(
      new Reflector(),
      prismaWith({ ...stage1User, profile: { ...stage1User.profile, gender: null } }) as never,
    );
    await expect(guard.canActivate(contextFor(join, { userId: 'u1' }))).rejects.toBeInstanceOf(
      ForbiddenException,
    );
  });

  it('fails closed without a caller', async () => {
    const guard = new KycStageGuard(new Reflector(), prismaWith(stage1User) as never);
    await expect(guard.canActivate(contextFor(withdraw))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

/**
 * The enforcement is only as good as its coverage, and a route that loses its
 * decorator fails open silently. This table is the list of gated routes: a
 * change to it should be a deliberate change here too.
 */
describe('gated routes', () => {
  const routes: [string, object, string, string][] = [
    ['create an Ajo group', AjoGroupsController, 'create', 'ajo.create'],
    ['join an Ajo group', AjoGroupsController, 'join', 'ajo.join'],
    ['pay a contribution', AjoGroupsController, 'payContribution', 'ajo.contribute'],
    ['invite to a group', AjoGroupsController, 'createInvitation', 'ajo.administer'],
    ['list a group', AjoGroupsController, 'setListing', 'ajo.administer'],
    ['lock a group', AjoGroupsController, 'lock', 'ajo.administer'],
    ['execute a payout', AjoGroupsController, 'executePayout', 'ajo.administer'],
    ['create an Akawo pool', AkawoPoolsController, 'create', 'akawo-pool.create'],
    ['join an Akawo pool', AkawoPoolsController, 'join', 'akawo-pool.join'],
    ['edit an Akawo pool', AkawoPoolsController, 'update', 'akawo-pool.administer'],
    ['open an Akawo pool', AkawoPoolsController, 'open', 'akawo-pool.administer'],
    ['waive a due', AkawoPoolsController, 'waive', 'akawo-pool.administer'],
    ['start a savings goal', AkawoController, 'create', 'akawo-goal.create'],
    ['schedule savings', AkawoController, 'createSchedule', 'akawo-goal.create'],
    ['create a payment', PaymentsController, 'create', 'payment'],
    ['confirm a payment', PaymentsController, 'confirm', 'payment'],
    ['withdraw', WalletsController, 'withdraw', 'withdrawal'],
    ['send money', WalletsController, 'send', 'wallet.send'],
    ['create a food programme', FoodAjoProgrammesController, 'create', 'food-programme.create'],
    ['join a food programme', FoodAjoProgrammesController, 'subscribe', 'food.subscribe'],
    [
      'submit a coordinator application',
      FoodCoordinatorApplicationsController,
      'submit',
      'food-coordinator.apply',
    ],
  ];

  it.each(routes)('gates the route to %s', (_label, controller, method, action) => {
    const target = handlerOf(controller, method);
    expect(Reflect.getMetadata(KYC_ACTION_KEY, target)).toBe(action);
    const guards = (Reflect.getMetadata(GUARDS_METADATA, target) ?? []) as unknown[];
    expect(guards).toContain(KycStageGuard);
  });
});
