import { NotificationChannel, NotificationStatus } from '../../../generated/prisma/enums.js';
import type { PrismaService } from '../../infrastructure/database/prisma.service.js';
import type { EmailProvider } from './providers/email-provider.js';
import type { SmsProvider } from './providers/sms-provider.js';
import { TransactionalNotificationService } from './transactional-notification.service.js';

function setup() {
  const notificationFindUnique = jest.fn().mockResolvedValue(null);
  const notificationCreate = jest.fn().mockResolvedValue({ id: 'notification-id' });
  const notificationUpdate = jest.fn().mockResolvedValue({});
  const deliveryCreate = jest.fn().mockResolvedValue({});
  const transaction = jest.fn().mockResolvedValue([]);
  const prisma = {
    notification: {
      findUnique: notificationFindUnique,
      create: notificationCreate,
      update: notificationUpdate,
    },
    notificationDelivery: { create: deliveryCreate },
    $transaction: transaction,
  } as unknown as PrismaService;
  const emailSend = jest.fn().mockResolvedValue({
    provider: 'resend',
    providerReference: '<message@resend>',
    accepted: true,
  });
  const emailProvider = {
    name: 'resend',
    send: emailSend,
  } as EmailProvider;
  const smsSend = jest.fn().mockResolvedValue({
    provider: 'resend',
    providerReference: '12345',
    accepted: true,
  });
  const smsProvider = {
    name: 'resend',
    send: smsSend,
  } as SmsProvider;
  return {
    prisma,
    emailProvider,
    smsProvider,
    emailSend,
    smsSend,
    notificationCreate,
    notificationUpdate,
    deliveryCreate,
    service: new TransactionalNotificationService(prisma, emailProvider, smsProvider),
  };
}

describe('TransactionalNotificationService', () => {
  it('sends and persists an email without storing transient verification codes', async () => {
    const { service, emailSend, notificationCreate } = setup();
    await expect(
      service.sendEmail({
        userId: 'user-id',
        destination: 'member@example.com',
        template: 'account-verification-email',
        variables: { code: '123456', expiresMinutes: '10' },
        storedPayload: { destination: 'm***@example.com', challengeId: 'challenge-id' },
        dedupeKey: 'account-verification:challenge-id',
      }),
    ).resolves.toEqual({ status: 'SENT', providerReference: '<message@resend>' });

    expect(emailSend).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'member@example.com',
        idempotencyKey: 'account-verification:challenge-id',
      }),
    );
    expect(notificationCreate).toHaveBeenCalledWith({
      data: {
        userId: 'user-id',
        channel: NotificationChannel.EMAIL,
        template: 'account-verification-email',
        templateVersion: 1,
        dedupeKey: 'account-verification:challenge-id',
        payload: { destination: 'm***@example.com', challengeId: 'challenge-id' },
      },
    });
    expect(JSON.stringify(notificationCreate.mock.calls)).not.toContain('123456');
  });

  it('records a generic failure without leaking provider details', async () => {
    const { service, smsSend, notificationUpdate, deliveryCreate } = setup();
    smsSend.mockRejectedValue(new Error('secret provider response'));

    await expect(
      service.sendSms({
        userId: 'user-id',
        destination: '+2348012345678',
        template: 'password-reset-sms',
        variables: { resetUrl: 'https://example.test/reset', expiresMinutes: '10' },
        storedPayload: { destination: '+234***5678', resetRequestId: 'request-id' },
        dedupeKey: 'password-reset:request-id',
      }),
    ).resolves.toEqual({ status: 'FAILED' });
    expect(notificationUpdate).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: NotificationStatus.FAILED } }),
    );
    const deliveryCall = JSON.stringify(deliveryCreate.mock.calls);
    expect(deliveryCall).toContain('DELIVERY_UNAVAILABLE');
    expect(deliveryCall).toContain('Transactional notification delivery was not accepted');
    expect(deliveryCall).not.toContain('secret provider response');
  });
});
