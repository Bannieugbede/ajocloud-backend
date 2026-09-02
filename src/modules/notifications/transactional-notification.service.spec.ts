import { NotificationChannel, NotificationStatus } from '../../../generated/prisma/enums.js';
import { firstArg } from '../../common/testing/mock-arguments.js';
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
  const preferenceFindUnique = jest.fn().mockResolvedValue(null);
  const pushSend = jest.fn().mockResolvedValue({ provider: 'console', results: [] });
  const pushProvider = { name: 'console', send: pushSend };
  const pushTokensFor = jest.fn().mockResolvedValue([]);
  const releaseUnregisteredToken = jest.fn().mockResolvedValue(undefined);
  const devices = { pushTokensFor, releaseUnregisteredToken };
  const prisma = {
    notificationPreference: { findUnique: preferenceFindUnique },
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
    preferenceFindUnique,
    pushSend,
    pushTokensFor,
    releaseUnregisteredToken,
    service: new TransactionalNotificationService(
      prisma,
      emailProvider,
      smsProvider,
      pushProvider,
      devices as never,
    ),
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

describe('notification preferences', () => {
  it('sends a product message when the user has expressed no preference', async () => {
    const { service, emailSend } = setup();
    await expect(
      service.sendEmail({
        userId: 'user-id',
        destination: 'member@example.com',
        template: 'ajo-payout-sent',
        variables: { groupName: 'Owo Ise', amount: '50,000', reference: 'AJO-PAYOUT-1' },
        storedPayload: { groupId: 'group-id' },
        dedupeKey: 'ajo-payout:cycle-id',
      }),
    ).resolves.toEqual({ status: 'SENT', providerReference: '<message@resend>' });
    expect(emailSend).toHaveBeenCalled();
  });

  it('suppresses a topic the user switched off, without calling the provider', async () => {
    const { service, emailSend, notificationCreate, preferenceFindUnique } = setup();
    preferenceFindUnique.mockResolvedValue({
      enabled: false,
      quietHoursStartMinutes: null,
      quietHoursEndMinutes: null,
      timezone: 'Africa/Lagos',
    });

    await expect(
      service.sendEmail({
        userId: 'user-id',
        destination: 'member@example.com',
        template: 'ajo-payout-sent',
        variables: { groupName: 'Owo Ise', amount: '50,000', reference: 'AJO-PAYOUT-1' },
        storedPayload: { groupId: 'group-id' },
        dedupeKey: 'ajo-payout:cycle-id',
      }),
    ).resolves.toEqual({ status: 'SUPPRESSED', reason: 'DISABLED' });

    expect(emailSend).not.toHaveBeenCalled();
    // No Notification row: the record describes delivery, and this was never
    // attempted. Writing one would also consume the dedupe key, so a later
    // permitted send of the same event would be swallowed as a duplicate.
    expect(notificationCreate).not.toHaveBeenCalled();
  });

  it('never suppresses a security message, whatever the preference says', async () => {
    const { service, emailSend, preferenceFindUnique } = setup();
    preferenceFindUnique.mockResolvedValue({
      enabled: false,
      quietHoursStartMinutes: 0,
      quietHoursEndMinutes: 24 * 60 - 1,
      timezone: 'Africa/Lagos',
    });

    // Someone who had switched off reset mail could not recover their account.
    await expect(
      service.sendEmail({
        userId: 'user-id',
        destination: 'member@example.com',
        template: 'password-reset',
        variables: { resetUrl: 'https://example.test/reset', expiresMinutes: '30' },
        storedPayload: { challengeId: 'challenge-id' },
        dedupeKey: 'password-reset:challenge-id',
      }),
    ).resolves.toEqual({ status: 'SENT', providerReference: '<message@resend>' });
    expect(emailSend).toHaveBeenCalled();
    // Security templates carry no topic, so preferences are not even consulted.
    expect(preferenceFindUnique).not.toHaveBeenCalled();
  });

  it('looks up the preference for the channel actually being used', async () => {
    const { service, preferenceFindUnique } = setup();
    await service.sendEmail({
      userId: 'user-id',
      destination: 'member@example.com',
      template: 'akawo-goal-reached',
      variables: { goalName: 'Rent', target: '500,000' },
      storedPayload: { goalId: 'goal-id' },
      dedupeKey: 'akawo-reached:goal-id',
    });
    expect(preferenceFindUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          userId_channel_topic: {
            userId: 'user-id',
            channel: NotificationChannel.EMAIL,
            topic: 'akawo.progress',
          },
        },
      }),
    );
  });
});

describe('push and in-app delivery', () => {
  const notifyInput = {
    userId: 'user-id',
    template: 'ajo-payout-sent',
    variables: { groupName: 'Owo Ise', amount: '₦50,000' },
    storedPayload: { groupId: 'group-id' },
    dedupeKey: 'ajo-payout:cycle-id',
  };

  it('writes the in-app entry even when no device can be reached', async () => {
    // Push is a prompt to open the app, not the notification itself. Delivering
    // only by push would mean someone who declined permission never learns
    // their payout arrived.
    const { service, notificationCreate, pushSend } = setup();
    const result = await service.notify(notifyInput);

    expect(result.inApp).toBe(true);
    expect(result.pushed).toBe(0);
    expect(pushSend).not.toHaveBeenCalled();
    const written = firstArg<{ data: { channel: string; title: string; body: string } }>(
      notificationCreate,
    );
    expect(written.data.channel).toBe(NotificationChannel.IN_APP);
    expect(written.data.title).toBe('Your payout was sent');
  });

  it('renders the copy once, so the feed never re-renders a changed template', async () => {
    const { service, notificationCreate } = setup();
    await service.notify(notifyInput);
    const written = firstArg<{ data: { body: string; deepLink: string } }>(notificationCreate);
    expect(written.data.body).toContain('₦50,000');
    expect(written.data.deepLink).toBe('/(tabs)/ajo');
  });

  it('pushes to every device the user holds', async () => {
    const { service, pushSend, pushTokensFor } = setup();
    pushTokensFor.mockResolvedValue(['ExponentPushToken[a]', 'ExponentPushToken[b]']);
    pushSend.mockResolvedValue({
      provider: 'expo',
      results: [
        { token: 'ExponentPushToken[a]', accepted: true, unregistered: false },
        { token: 'ExponentPushToken[b]', accepted: true, unregistered: false },
      ],
    });

    const result = await service.notify(notifyInput);
    expect(result.pushed).toBe(2);
  });

  it('carries only routing information in the push payload', async () => {
    // Push payloads travel through Apple's and Google's infrastructure and show
    // on a lock screen, so nothing private belongs in them.
    const { service, pushSend, pushTokensFor } = setup();
    pushTokensFor.mockResolvedValue(['ExponentPushToken[a]']);
    pushSend.mockResolvedValue({ provider: 'expo', results: [] });

    await service.notify(notifyInput);
    const sent = firstArg<{ data: Record<string, string> }>(pushSend);
    expect(sent.data).toEqual({ deepLink: '/(tabs)/ajo' });
  });

  it('releases a token the provider says is dead', async () => {
    const { service, pushSend, pushTokensFor, releaseUnregisteredToken } = setup();
    pushTokensFor.mockResolvedValue(['ExponentPushToken[a]']);
    pushSend.mockResolvedValue({
      provider: 'expo',
      results: [{ token: 'ExponentPushToken[a]', accepted: false, unregistered: true }],
    });

    await service.notify(notifyInput);
    expect(releaseUnregisteredToken).toHaveBeenCalledWith('ExponentPushToken[a]');
  });

  it('keeps a token that failed for a transient reason', async () => {
    const { service, pushSend, pushTokensFor, releaseUnregisteredToken } = setup();
    pushTokensFor.mockResolvedValue(['ExponentPushToken[a]']);
    pushSend.mockResolvedValue({
      provider: 'expo',
      results: [{ token: 'ExponentPushToken[a]', accepted: false, unregistered: false }],
    });

    await service.notify(notifyInput);
    expect(releaseUnregisteredToken).not.toHaveBeenCalled();
  });

  it('still writes in-app when the user switched push off', async () => {
    const { service, pushSend, preferenceFindUnique } = setup();
    preferenceFindUnique.mockImplementation(
      ({ where }: { where: { userId_channel_topic: { channel: string } } }) =>
        Promise.resolve(
          where.userId_channel_topic.channel === NotificationChannel.PUSH
            ? {
                enabled: false,
                quietHoursStartMinutes: null,
                quietHoursEndMinutes: null,
                timezone: 'Africa/Lagos',
              }
            : null,
        ),
    );

    const result = await service.notify(notifyInput);
    expect(result.inApp).toBe(true);
    expect(pushSend).not.toHaveBeenCalled();
  });

  it('does nothing for a template with no short-form copy', async () => {
    // Security templates are email-only on purpose: a push saying someone
    // signed in is useful, but a recovery link must go to a mailbox.
    const { service, notificationCreate, pushSend } = setup();
    const result = await service.notify({ ...notifyInput, template: 'password-reset' });
    expect(result).toEqual({ inApp: false, pushed: 0 });
    expect(notificationCreate).not.toHaveBeenCalled();
    expect(pushSend).not.toHaveBeenCalled();
  });
});
