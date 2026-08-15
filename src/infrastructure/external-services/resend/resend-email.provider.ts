import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../config/env.schema.js';
import type {
  EmailDeliveryResult,
  EmailProvider,
  SendEmailInput,
} from '../../../modules/notifications/providers/email-provider.js';
import { ResendClientService } from './resend-client.service.js';

@Injectable()
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  private readonly senderEmail: string;
  private readonly senderName: string;

  constructor(
    private readonly resend: ResendClientService,
    config: ConfigService<Environment, true>,
  ) {
    this.senderEmail = config.get('RESEND_SENDER_EMAIL', { infer: true }) ?? '';
    this.senderName = config.get('RESEND_SENDER_NAME', { infer: true }) ?? 'Ajo Cloud';
  }

  async send(input: SendEmailInput): Promise<EmailDeliveryResult> {
    if (!this.senderEmail) throw new ServiceUnavailableException('Resend sender is not configured');
    if (!input.html && !input.text) {
      throw new ServiceUnavailableException('Email content is unavailable');
    }
    const response = await this.resend.sendEmail({
      from: `${this.senderName} <${this.senderEmail}>`,
      to: [input.to],
      subject: input.subject,
      ...(input.html ? { html: input.html } : {}),
      ...(input.text ? { text: input.text } : {}),
      // Resend tag values allow only ASCII letters, numbers, underscores and dashes.
      ...(input.templateId
        ? { tags: [{ name: 'template', value: input.templateId.replaceAll(/[^\w-]/g, '_') }] }
        : {}),
      idempotencyKey: input.idempotencyKey,
    });
    return { provider: this.name, providerReference: response.id, accepted: true };
  }
}
