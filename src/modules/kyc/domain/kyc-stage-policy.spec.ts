import {
  KYC_ACTION_STAGES,
  completedLevel,
  currentStage,
  describeStages,
  refusalMessage,
  satisfiesStage,
  tierForLevel,
  type KycFacts,
} from './kyc-stage-policy.js';

const nothing: KycFacts = {
  accountActive: false,
  basicInfoComplete: false,
  pinSet: false,
  nin: 'none',
  ninDocumentUploaded: false,
  address: 'none',
  restricted: false,
};

const stage1: KycFacts = { ...nothing, accountActive: true, basicInfoComplete: true };
const stage2: KycFacts = { ...stage1, pinSet: true, nin: 'passed', ninDocumentUploaded: true };
const stage3: KycFacts = { ...stage2, address: 'passed' };

describe('completedLevel', () => {
  it('counts each finished stage', () => {
    expect(completedLevel(nothing)).toBe(0);
    expect(completedLevel(stage1)).toBe(1);
    expect(completedLevel(stage2)).toBe(2);
    expect(completedLevel(stage3)).toBe(3);
  });

  it('never counts a later stage past an unfinished earlier one', () => {
    // A verified NIN and address mean nothing without basic details.
    expect(completedLevel({ ...stage3, basicInfoComplete: false })).toBe(0);
    // An address passed without a NIN document stops at stage 1.
    expect(completedLevel({ ...stage3, ninDocumentUploaded: false })).toBe(1);
  });

  it('needs every stage 2 item: PIN, NIN and the document', () => {
    expect(completedLevel({ ...stage2, pinSet: false })).toBe(1);
    expect(completedLevel({ ...stage2, nin: 'pending' })).toBe(1);
    expect(completedLevel({ ...stage2, ninDocumentUploaded: false })).toBe(1);
  });

  it('counts nothing for a restricted profile', () => {
    expect(completedLevel({ ...stage3, restricted: true })).toBe(0);
  });
});

describe('currentStage', () => {
  it('is the first unfinished stage, or null when all are done', () => {
    expect(currentStage(nothing)).toBe(1);
    expect(currentStage(stage1)).toBe(2);
    expect(currentStage(stage2)).toBe(3);
    expect(currentStage(stage3)).toBeNull();
  });
});

describe('describeStages', () => {
  it('shows done, working and waiting stages', () => {
    expect(describeStages(stage1).map((stage) => stage.status)).toEqual([
      'complete',
      'in_progress',
      'locked',
    ]);
  });

  it('shows a stage waiting only on a reviewer as under review', () => {
    const view = describeStages({ ...stage2, address: 'pending' });
    expect(view[2]?.status).toBe('under_review');
  });

  it('keeps a stage in progress while anything is still missing', () => {
    const view = describeStages({ ...stage1, nin: 'pending' });
    expect(view[1]?.status).toBe('in_progress');
  });

  it('marks a failed address so the person knows to try again', () => {
    const view = describeStages({ ...stage2, address: 'failed' });
    expect(view[2]?.requirements[0]?.state).toBe('failed');
  });
});

describe('action stages', () => {
  it('matches the product rules', () => {
    expect(KYC_ACTION_STAGES['ajo.join']).toBe(1);
    expect(KYC_ACTION_STAGES['akawo-pool.join']).toBe(1);
    expect(KYC_ACTION_STAGES.payment).toBe(1);
    expect(KYC_ACTION_STAGES.withdrawal).toBe(2);
    expect(KYC_ACTION_STAGES['wallet.send']).toBe(2);
    expect(KYC_ACTION_STAGES['ajo.create']).toBe(3);
    expect(KYC_ACTION_STAGES['akawo-pool.create']).toBe(3);
  });

  it('lets a stage 1 member join and pay but not withdraw or create', () => {
    expect(satisfiesStage(stage1, KYC_ACTION_STAGES['ajo.join'])).toBe(true);
    expect(satisfiesStage(stage1, KYC_ACTION_STAGES.withdrawal)).toBe(false);
    expect(satisfiesStage(stage2, KYC_ACTION_STAGES.withdrawal)).toBe(true);
    expect(satisfiesStage(stage2, KYC_ACTION_STAGES['ajo.create'])).toBe(false);
    expect(satisfiesStage(stage3, KYC_ACTION_STAGES['ajo.create'])).toBe(true);
  });

  it('names the stage in a refusal', () => {
    expect(refusalMessage('withdrawal', stage1)).toBe(
      'Complete stage 2 (Identity) verification to withdraw.',
    );
    expect(refusalMessage('ajo.create', { ...stage3, restricted: true })).toMatch(/not approved/);
  });
});

describe('tierForLevel', () => {
  it('mirrors the level, with no tier below 1', () => {
    expect([0, 1, 2, 3].map((level) => tierForLevel(level as 0 | 1 | 2 | 3))).toEqual([
      'TIER_1',
      'TIER_1',
      'TIER_2',
      'TIER_3',
    ]);
  });
});
