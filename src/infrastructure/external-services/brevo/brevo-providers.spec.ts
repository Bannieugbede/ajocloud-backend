import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../config/env.schema.js';
import { BrevoClientService } from './brevo-client.service.js';
import { BrevoEmailProvider } from './brevo-email.provider.js';
import { BrevoSmsProvider } from './brevo-sms.provider.js';

function config(values: Partial<Environment>): ConfigService<Environment, true> {
  return {
    get: jest.fn((key: keyof Environment) => values[key]),
  } as unknown as ConfigService<Environment, true>;
}

describe('Brevo providers', () => {
  it('sends a transactional email with sender and idempotency metadata', async () => {
    const sendEmail = jest.fn().mockResolvedValue({ messageId: '<message@brevo>' });
    const brevo = {
      sendEmail,
    } as unknown as BrevoClientService;
    const provider = new BrevoEmailProvider(
      brevo,
      config({ BREVO_SENDER_EMAIL: 'verified@example.com', BREVO_SENDER_NAME: 'Ajo Cloud' }),
    );

    await expect(
      provider.send({
        to: 'member@example.com',
        subject: 'Welcome',
        html: '<p>Welcome</p>',
        text: 'Welcome',
        templateId: 'welcome',
        idempotencyKey: 'welcome:user-id',
      }),
    ).resolves.toEqual({
      provider: 'brevo',
      providerReference: '<message@brevo>',
      accepted: true,
    });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        sender: { email: 'verified@example.com', name: 'Ajo Cloud' },
        headers: { 'Idempotency-Key': 'welcome:user-id' },
        tags: ['welcome'],
      }),
    );
  });

  it('sends transactional SMS with an approved sender name', async () => {
    const sendSms = jest.fn().mockResolvedValue({ messageId: 12345 });
    const brevo = {
      sendSms,
    } as unknown as BrevoClientService;
    const provider = new BrevoSmsProvider(brevo, config({ BREVO_SMS_SENDER: 'AjoCloud' }));

    await expect(
      provider.send({
        to: '+2348012345678',
        content: 'Your Ajo Cloud contribution is due tomorrow.',
        templateId: 'transactional-alert',
        idempotencyKey: 'challenge-id',
      }),
    ).resolves.toEqual({
      provider: 'brevo',
      providerReference: '12345',
      accepted: true,
    });
    expect(sendSms).toHaveBeenCalledWith(
      expect.objectContaining({
        recipient: '+2348012345678',
        sender: 'AjoCloud',
        type: 'transactional',
      }),
    );
  });
});
