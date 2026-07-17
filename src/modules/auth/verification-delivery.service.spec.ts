import { ServiceUnavailableException } from '@nestjs/common';
import type { TransactionalNotificationService } from '../notifications/transactional-notification.service.js';
import { VerificationDeliveryService } from './verification-delivery.service.js';

describe('VerificationDeliveryService', () => {
  const input = {
    userId: 'user-id',
    challengeId: 'challenge-id',
    destination: 'member@example.com',
    destinationMasked: 'me•••@example.com',
    code: '123456',
  } as const;

  it('routes account verification through the email template', async () => {
    const sendEmail = jest.fn().mockResolvedValue({
      status: 'SENT',
      providerReference: '<message@brevo>',
    });
    const notifications = { sendEmail } as unknown as TransactionalNotificationService;
    const service = new VerificationDeliveryService(notifications);

    await service.send(input);

    expect(sendEmail).toHaveBeenCalledWith({
      userId: 'user-id',
      destination: 'member@example.com',
      template: 'account-verification-email',
      variables: { code: '123456', expiresMinutes: '10' },
      storedPayload: { destination: 'me•••@example.com', challengeId: 'challenge-id' },
      dedupeKey: 'account-verification:challenge-id',
    });
  });

  it('surfaces a persisted provider failure to the auth flow', async () => {
    const notifications = {
      sendEmail: jest.fn().mockResolvedValue({ status: 'FAILED' }),
    } as unknown as TransactionalNotificationService;
    const service = new VerificationDeliveryService(notifications);

    await expect(service.send(input)).rejects.toBeInstanceOf(ServiceUnavailableException);
  });
});
