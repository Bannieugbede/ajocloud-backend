/**
 * The first argument a jest mock was called with, typed at the call site.
 *
 * Jest's own `mock.calls` is `any`, and asserting on the captured argument is
 * clearer than nesting matchers — it shows exactly what reached the database.
 */
export function firstArg<T>(mock: unknown): T {
  const calls = (mock as { mock: { calls: unknown[][] } }).mock.calls;
  const call = calls[0];
  if (!call) throw new Error('Expected the mock to have been called');
  return call[0] as T;
}
