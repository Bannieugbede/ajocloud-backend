import { reserveActionForProviderState } from './bill-payment-policy.js';

describe('Bill Payment reserve policy', () => {
  it('settles only confirmed success', () => {
    expect(reserveActionForProviderState('SUCCESSFUL')).toBe('SETTLE');
  });

  it('releases only confirmed failure', () => {
    expect(reserveActionForProviderState('FAILED')).toBe('RELEASE');
  });

  it.each(['PENDING', 'UNKNOWN'] as const)('holds funds for %s results', (state) => {
    expect(reserveActionForProviderState(state)).toBe('HOLD_FOR_RECONCILIATION');
  });
});
