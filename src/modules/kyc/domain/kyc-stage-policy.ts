/**
 * Staged verification (ADR-015). Pure, so the rules that decide what a person
 * may do can be tested without a database.
 *
 * Three stages, each built on the one before:
 *
 * 1. **Account**: signed up with a verified email, plus basic details (date of
 *    birth, gender, occupation). Enough to join groups and pay into them.
 * 2. **Identity**: a transaction PIN, a NIN confirmed with Monnify, and a photo
 *    of the NIN slip or card. Enough to move money out: withdraw or send.
 * 3. **Address**: a residential address that matches the one on the NIN
 *    record. Enough to run a group and collect money from others.
 *
 * What a person may do is decided from these facts every time, never from a
 * stored tier alone, so a tier granted under older rules cannot unlock more
 * than the evidence supports.
 */

export type KycStage = 1 | 2 | 3;

/** How many stages are complete: 0 until stage 1 is done. */
export type KycLevel = 0 | 1 | 2 | 3;

/** A check's state as far as staging cares. `pending` means awaiting a reviewer. */
export type CheckState = 'none' | 'pending' | 'passed' | 'failed';

export interface KycFacts {
  /** Signed up and verified their email or phone. */
  readonly accountActive: boolean;
  readonly basicInfoComplete: boolean;
  readonly pinSet: boolean;
  readonly nin: CheckState;
  readonly ninDocumentUploaded: boolean;
  readonly address: CheckState;
  /** A reviewer rejected the profile. Nothing beyond browsing is allowed. */
  readonly restricted: boolean;
}

export type StageStatus =
  /** Every requirement met. */
  | 'complete'
  /** The next stage to work on. */
  | 'in_progress'
  /** Everything submitted; a reviewer has to confirm something. */
  | 'under_review'
  /** Waiting on an earlier stage. */
  | 'locked';

export type RequirementKey = 'account' | 'basicInfo' | 'pin' | 'nin' | 'ninDocument' | 'address';

export interface StageRequirement {
  readonly key: RequirementKey;
  readonly label: string;
  readonly state: 'complete' | 'pending' | 'failed' | 'missing';
}

export interface StageView {
  readonly stage: KycStage;
  readonly title: string;
  readonly status: StageStatus;
  readonly requirements: readonly StageRequirement[];
  /** What completing this stage lets a person do, in their words. */
  readonly unlocks: readonly string[];
}

export const STAGE_TITLES: Record<KycStage, string> = {
  1: 'Account',
  2: 'Identity',
  3: 'Address',
};

const STAGE_UNLOCKS: Record<KycStage, readonly string[]> = {
  1: ['Join Ajo groups and Akawo pools', 'Make payments and contributions'],
  2: ['Withdraw to your bank account', 'Send money to other members'],
  3: ['Create and run groups as an admin', 'Collect money from members'],
};

function requirementState(state: CheckState): StageRequirement['state'] {
  switch (state) {
    case 'passed':
      return 'complete';
    case 'pending':
      return 'pending';
    case 'failed':
      return 'failed';
    case 'none':
      return 'missing';
  }
}

function flag(met: boolean): StageRequirement['state'] {
  return met ? 'complete' : 'missing';
}

export function stageRequirements(facts: KycFacts): Record<KycStage, StageRequirement[]> {
  return {
    1: [
      { key: 'account', label: 'Sign up and verify your email', state: flag(facts.accountActive) },
      {
        key: 'basicInfo',
        label: 'Add your date of birth, gender and occupation',
        state: flag(facts.basicInfoComplete),
      },
    ],
    2: [
      { key: 'pin', label: 'Set your transaction PIN', state: flag(facts.pinSet) },
      { key: 'nin', label: 'Verify your NIN', state: requirementState(facts.nin) },
      {
        key: 'ninDocument',
        label: 'Upload a photo of your NIN slip or card',
        state: flag(facts.ninDocumentUploaded),
      },
    ],
    3: [
      {
        key: 'address',
        label: 'Confirm the address on your NIN',
        state: requirementState(facts.address),
      },
    ],
  };
}

/**
 * The number of stages complete. Stages are strictly ordered: a later stage
 * never counts while an earlier one is incomplete, and a restricted profile
 * counts none at all.
 */
export function completedLevel(facts: KycFacts): KycLevel {
  if (facts.restricted) return 0;
  const requirements = stageRequirements(facts);
  let level: KycLevel = 0;
  for (const stage of [1, 2, 3] as const) {
    if (!requirements[stage].every((requirement) => requirement.state === 'complete')) break;
    level = stage;
  }
  return level;
}

/** The stage the person is working on, or null once all three are complete. */
export function currentStage(facts: KycFacts): KycStage | null {
  const level = completedLevel(facts);
  return level === 3 ? null : ((level + 1) as KycStage);
}

export function describeStages(facts: KycFacts): StageView[] {
  const requirements = stageRequirements(facts);
  const level = completedLevel(facts);
  return ([1, 2, 3] as const).map((stage) => {
    const items = requirements[stage];
    let status: StageStatus;
    if (stage <= level) status = 'complete';
    else if (stage > level + 1 || facts.restricted) status = 'locked';
    else if (
      items.some((item) => item.state === 'pending') &&
      items.every((item) => item.state === 'complete' || item.state === 'pending')
    ) {
      status = 'under_review';
    } else status = 'in_progress';
    return {
      stage,
      title: STAGE_TITLES[stage],
      status,
      requirements: items,
      unlocks: STAGE_UNLOCKS[stage],
    };
  });
}

/**
 * Every gated action and the stage it needs. One table, so the rules the
 * backend enforces and the ones the apps show are the same list.
 */
export const KYC_ACTION_STAGES = {
  'ajo.join': 1,
  'ajo.contribute': 1,
  'akawo-pool.join': 1,
  'akawo-goal.create': 1,
  'food.subscribe': 1,
  payment: 1,
  withdrawal: 2,
  'wallet.send': 2,
  'ajo.create': 3,
  'ajo.administer': 3,
  'akawo-pool.create': 3,
  'akawo-pool.administer': 3,
  'food-programme.create': 3,
  'food-coordinator.apply': 3,
} as const satisfies Record<string, KycStage>;

export type KycAction = keyof typeof KYC_ACTION_STAGES;

/** Phrases for refusals, e.g. "Complete stage 2 (Identity) to withdraw". */
const ACTION_PHRASES: Record<KycAction, string> = {
  'ajo.join': 'join an Ajo group',
  'ajo.contribute': 'pay contributions',
  'akawo-pool.join': 'join an Akawo pool',
  'akawo-goal.create': 'start an Akawo savings goal',
  'food.subscribe': 'join a food programme',
  payment: 'make payments',
  withdrawal: 'withdraw',
  'wallet.send': 'send money',
  'ajo.create': 'create an Ajo group',
  'ajo.administer': 'manage an Ajo group',
  'akawo-pool.create': 'create an Akawo pool',
  'akawo-pool.administer': 'manage an Akawo pool',
  'food-programme.create': 'create a food programme',
  'food-coordinator.apply': 'apply as a food coordinator',
};

export function satisfiesStage(facts: KycFacts, required: KycStage): boolean {
  return completedLevel(facts) >= required;
}

export function refusalMessage(action: KycAction, facts: KycFacts): string {
  if (facts.restricted) {
    return 'Your verification was not approved. Contact support to continue.';
  }
  const required = KYC_ACTION_STAGES[action];
  return `Complete stage ${required} (${STAGE_TITLES[required]}) verification to ${ACTION_PHRASES[action]}.`;
}

/** The stored tier that mirrors a level. The enum has no tier below 1. */
export function tierForLevel(level: KycLevel): 'TIER_1' | 'TIER_2' | 'TIER_3' {
  return level === 3 ? 'TIER_3' : level === 2 ? 'TIER_2' : 'TIER_1';
}
