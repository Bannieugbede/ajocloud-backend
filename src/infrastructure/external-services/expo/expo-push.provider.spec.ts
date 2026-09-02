import type { ConfigService } from '@nestjs/config';
import { ExpoPushProvider } from './expo-push.provider.js';

const TOKEN = (index: number) => `ExponentPushToken[token${String(index)}]`;

function build(fetchImpl: jest.Mock) {
  global.fetch = fetchImpl as unknown as typeof fetch;
  const config = { get: jest.fn().mockReturnValue(undefined) } as unknown as ConfigService<
    never,
    true
  >;
  return new ExpoPushProvider(config);
}

const ok = (tickets: unknown[]) =>
  jest.fn().mockResolvedValue({
    ok: true,
    json: () => Promise.resolve({ data: tickets }),
  });

describe('ExpoPushProvider', () => {
  afterEach(() => jest.restoreAllMocks());

  it('reports each token separately, so one failure does not sink the batch', async () => {
    const fetchImpl = ok([
      { status: 'ok', id: 'ticket-1' },
      { status: 'error', message: 'gone', details: { error: 'DeviceNotRegistered' } },
    ]);
    const provider = build(fetchImpl);

    const result = await provider.send({
      to: [TOKEN(1), TOKEN(2)],
      title: 'Payout sent',
      body: 'Your payout arrived',
      idempotencyKey: 'key-1',
    });

    expect(result.results[0]).toEqual(
      expect.objectContaining({ token: TOKEN(1), accepted: true, unregistered: false }),
    );
    expect(result.results[1]).toEqual(
      expect.objectContaining({ token: TOKEN(2), accepted: false, unregistered: true }),
    );
  });

  it('marks only DeviceNotRegistered as permanently dead', async () => {
    // Anything else may be transient, and dropping a live token would silently
    // stop a working device from ever being reached again.
    const provider = build(
      ok([{ status: 'error', message: 'rate limited', details: { error: 'MessageRateExceeded' } }]),
    );
    const result = await provider.send({
      to: [TOKEN(1)],
      title: 't',
      body: 'b',
      idempotencyKey: 'key-2',
    });
    expect(result.results[0]?.unregistered).toBe(false);
    expect(result.results[0]?.failureReason).toBe('PUSH_REJECTED');
  });

  it('splits more than a hundred tokens across requests', async () => {
    // Expo accepts at most 100 messages per call.
    const fetchImpl = jest.fn().mockImplementation((_url: string, init: { body: string }) => {
      const messages = JSON.parse(init.body) as unknown[];
      return Promise.resolve({
        ok: true,
        json: () => Promise.resolve({ data: messages.map(() => ({ status: 'ok', id: 'x' })) }),
      });
    });
    const provider = build(fetchImpl);

    const tokens = Array.from({ length: 250 }, (_, index) => TOKEN(index));
    const result = await provider.send({
      to: tokens,
      title: 't',
      body: 'b',
      idempotencyKey: 'key-3',
    });

    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(result.results).toHaveLength(250);
    expect(result.results.every((entry) => entry.accepted)).toBe(true);
  });

  it('treats a transport failure as retryable, not as dead tokens', async () => {
    const provider = build(jest.fn().mockRejectedValue(new Error('network down')));
    const result = await provider.send({
      to: [TOKEN(1), TOKEN(2)],
      title: 't',
      body: 'b',
      idempotencyKey: 'key-4',
    });
    expect(result.results.every((entry) => entry.unregistered)).toBe(false);
    expect(result.results.every((entry) => entry.failureReason === 'PUSH_TRANSPORT_FAILED')).toBe(
      true,
    );
  });

  it('treats a non-200 response the same way', async () => {
    const provider = build(jest.fn().mockResolvedValue({ ok: false, status: 503 }));
    const result = await provider.send({
      to: [TOKEN(1)],
      title: 't',
      body: 'b',
      idempotencyKey: 'key-5',
    });
    expect(result.results[0]?.unregistered).toBe(false);
  });

  it('does not claim success for a token Expo returned no ticket for', async () => {
    const provider = build(ok([]));
    const result = await provider.send({
      to: [TOKEN(1)],
      title: 't',
      body: 'b',
      idempotencyKey: 'key-6',
    });
    expect(result.results[0]).toEqual(
      expect.objectContaining({ accepted: false, failureReason: 'PUSH_NO_TICKET' }),
    );
  });
});
