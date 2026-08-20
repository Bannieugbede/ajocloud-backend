import { createHmac } from 'node:crypto';
import { MonnifyWebhooksService } from './monnify-webhooks.service.js';

const SIGNATURE = createHmac('sha512', 'secret').update('body').digest('hex');

function build(options: { existing?: boolean; createFails?: unknown } = {}) {
  const create = options.createFails
    ? jest.fn().mockRejectedValue(options.createFails)
    : jest.fn().mockResolvedValue({ id: 'event-1' });
  const prisma = {
    paymentWebhookEvent: {
      findUnique: jest.fn().mockResolvedValue(options.existing ? { id: 'event-1' } : null),
      create,
    },
  };
  const audit = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new MonnifyWebhooksService(prisma as never, audit as never);
  return { service, prisma, audit };
}

const PAYLOAD = {
  eventType: 'SUCCESSFUL_TRANSACTION',
  eventData: {
    transactionReference: 'MNFY|0001',
    amountPaid: '2500.00',
    currency: 'NGN',
    paidOn: new Date().toISOString(),
  },
};
const RAW = Buffer.from(JSON.stringify(PAYLOAD));

describe('MonnifyWebhooksService', () => {
  it('records a first delivery', async () => {
    const { service, prisma } = build();
    const result = await service.record('TRANSACTION_COMPLETION', PAYLOAD, RAW, SIGNATURE);

    expect(result).toEqual({ received: true, firstDelivery: true });
    const [call] = prisma.paymentWebhookEvent.create.mock.calls as [
      [{ data: { provider: string; providerEventId: string; status: string } }],
    ];
    expect(call[0].data.provider).toBe('monnify');
    expect(call[0].data.providerEventId).toBe('TRANSACTION_COMPLETION:MNFY|0001');
    expect(call[0].data.status).toBe('PENDING');
  });

  it('treats a redelivery as a no-op so the effect happens once', async () => {
    const { service, prisma } = build({ existing: true });
    const result = await service.record('TRANSACTION_COMPLETION', PAYLOAD, RAW, SIGNATURE);

    expect(result).toEqual({ received: true, firstDelivery: false });
    expect(prisma.paymentWebhookEvent.create).not.toHaveBeenCalled();
  });

  it('treats a concurrent duplicate losing the unique-constraint race as a duplicate', async () => {
    const { service } = build({ createFails: Object.assign(new Error('dup'), { code: 'P2002' }) });
    const result = await service.record('TRANSACTION_COMPLETION', PAYLOAD, RAW, SIGNATURE);
    expect(result).toEqual({ received: true, firstDelivery: false });
  });

  it('propagates a genuine database failure rather than acknowledging it', async () => {
    const { service } = build({ createFails: new Error('connection lost') });
    await expect(service.record('TRANSACTION_COMPLETION', PAYLOAD, RAW, SIGNATURE)).rejects.toThrow(
      'connection lost',
    );
  });

  it('stores a hash of the signature, never the signature itself', async () => {
    const { service, prisma } = build();
    await service.record('TRANSACTION_COMPLETION', PAYLOAD, RAW, SIGNATURE);

    const [call] = prisma.paymentWebhookEvent.create.mock.calls as [
      [{ data: { signatureHash?: string } }],
    ];
    expect(call[0].data.signatureHash).toBeDefined();
    expect(call[0].data.signatureHash).not.toBe(SIGNATURE);
    expect(JSON.stringify(prisma.paymentWebhookEvent.create.mock.calls)).not.toContain(SIGNATURE);
  });

  it('never persists the raw payload body', async () => {
    const { service, prisma, audit } = build();
    await service.record('TRANSACTION_COMPLETION', PAYLOAD, RAW, SIGNATURE);

    const persisted = JSON.stringify(prisma.paymentWebhookEvent.create.mock.calls);
    expect(persisted).not.toContain('eventData');
    expect(persisted).toContain('payloadHash');
    expect(JSON.stringify(audit.record.mock.calls)).not.toContain('eventData');
  });

  it('marks a stale event failed instead of acting on a replay', async () => {
    const { service, prisma } = build();
    const stale = {
      ...PAYLOAD,
      eventData: { ...PAYLOAD.eventData, paidOn: '2020-01-01T00:00:00.000Z' },
    };
    await service.record(
      'TRANSACTION_COMPLETION',
      stale,
      Buffer.from(JSON.stringify(stale)),
      SIGNATURE,
    );

    const [call] = prisma.paymentWebhookEvent.create.mock.calls as [
      [{ data: { status: string; failureReason?: string } }],
    ];
    expect(call[0].data.status).toBe('FAILED');
    expect(call[0].data.failureReason).toBe('Event timestamp outside tolerance');
  });

  it('records an audit entry naming the event kind', async () => {
    const { service, audit } = build();
    await service.record('SETTLEMENT', PAYLOAD, RAW, SIGNATURE);

    const [call] = audit.record.mock.calls as [[{ action: string; subjectType: string }]];
    expect(call[0].action).toBe('webhook.monnify.settlement');
    expect(call[0].subjectType).toBe('PaymentWebhookEvent');
  });

  it('accepts a delivery with no signature without crashing', async () => {
    const { service, prisma } = build();
    const result = await service.record('LOW_BALANCE', PAYLOAD, RAW, undefined);

    expect(result.received).toBe(true);
    const [call] = prisma.paymentWebhookEvent.create.mock.calls as [
      [{ data: { signatureHash?: string } }],
    ];
    expect(call[0].data.signatureHash).toBeUndefined();
  });

  it('keeps each event kind in its own dedupe namespace', async () => {
    const { service, prisma } = build();
    await service.record('DISBURSEMENT', PAYLOAD, RAW, SIGNATURE);
    await service.record('REFUND_COMPLETION', PAYLOAD, RAW, SIGNATURE);

    const ids = (
      prisma.paymentWebhookEvent.create.mock.calls as [{ data: { providerEventId: string } }][]
    ).map(([call]) => call.data.providerEventId);
    expect(new Set(ids).size).toBe(2);
  });
});
