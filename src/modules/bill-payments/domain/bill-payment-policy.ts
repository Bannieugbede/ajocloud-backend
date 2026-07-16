export type ReserveAction = 'SETTLE' | 'RELEASE' | 'HOLD_FOR_RECONCILIATION';

export function reserveActionForProviderState(
  state: 'PENDING' | 'SUCCESSFUL' | 'FAILED' | 'UNKNOWN' | 'REVERSED',
): ReserveAction {
  if (state === 'SUCCESSFUL') return 'SETTLE';
  if (state === 'FAILED') return 'RELEASE';
  return 'HOLD_FOR_RECONCILIATION';
}
