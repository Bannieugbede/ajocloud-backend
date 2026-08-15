import type { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../config/env.schema.js';
import type { ResendClientService } from './resend-client.service.js';
import { ResendEmailProvider } from './resend-email.provider.js';

function config(values: Partial<Environment>): ConfigService<Environment, true> {
  return {
    get: jest.fn((key: keyof Environment) => values[key]),
  } as unknown as ConfigService<Environment, true>;
}

describe('ResendEmailProvider', () => {
  it('sends a transactional email with sender and idempotency metadata', async () => {
    const sendEmail = jest.fn().mockResolvedValue({ id: 'b7c9f0e1-0000-4000-8000-000000000000' });
    const resend = { sendEmail } as unknown as ResendClientService;
    const provider = new ResendEmailProvider(
      resend,
      config({ RESEND_SENDER_EMAIL: 'verified@example.com', RESEND_SENDER_NAME: 'Ajo Cloud' }),
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
      provider: 'resend',
      providerReference: 'b7c9f0e1-0000-4000-8000-000000000000',
      accepted: true,
    });
    expect(sendEmail).toHaveBeenCalledWith(
      expect.objectContaining({
        from: 'Ajo Cloud <verified@example.com>',
        to: ['member@example.com'],
        subject: 'Welcome',
        tags: [{ name: 'template', value: 'welcome' }],
        idempotencyKey: 'welcome:user-id',
      }),
    );
  });

  it('refuses to send when no sender is configured', async () => {
    const resend = { sendEmail: jest.fn() } as unknown as ResendClientService;
    const provider = new ResendEmailProvider(resend, config({}));

    await expect(
      provider.send({
        to: 'member@example.com',
        subject: 'Welcome',
        text: 'Welcome',
        idempotencyKey: 'welcome:user-id',
      }),
    ).rejects.toThrow('Resend sender is not configured');
  });

  it('refuses to send an email with no content', async () => {
    const resend = { sendEmail: jest.fn() } as unknown as ResendClientService;
    const provider = new ResendEmailProvider(
      resend,
      config({ RESEND_SENDER_EMAIL: 'verified@example.com' }),
    );

    await expect(
      provider.send({
        to: 'member@example.com',
        subject: 'Welcome',
        idempotencyKey: 'welcome:user-id',
      }),
    ).rejects.toThrow('Email content is unavailable');
  });
});
