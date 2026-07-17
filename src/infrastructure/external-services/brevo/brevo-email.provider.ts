import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../config/env.schema.js';
import type {
  EmailDeliveryResult,
  EmailProvider,
  SendEmailInput,
} from '../../../modules/notifications/providers/email-provider.js';
import { BrevoClientService } from './brevo-client.service.js';

@Injectable()
export class BrevoEmailProvider implements EmailProvider {
  readonly name = 'brevo';
  private readonly senderEmail: string;
  private readonly senderName: string;

  constructor(
    private readonly brevo: BrevoClientService,
    config: ConfigService<Environment, true>,
  ) {
    this.senderEmail = config.get('BREVO_SENDER_EMAIL', { infer: true }) ?? '';
    this.senderName = config.get('BREVO_SENDER_NAME', { infer: true }) ?? 'Ajo Cloud';
  }

  async send(input: SendEmailInput): Promise<EmailDeliveryResult> {
    if (!this.senderEmail) throw new ServiceUnavailableException('Brevo sender is not configured');
    if (!input.html && !input.text) {
      throw new ServiceUnavailableException('Email content is unavailable');
    }
    const response = await this.brevo.sendEmail({
      sender: { email: this.senderEmail, name: this.senderName },
      to: [{ email: input.to }],
      subject: input.subject,
      ...(input.html ? { htmlContent: input.html } : {}),
      ...(input.text ? { textContent: input.text } : {}),
      headers: { 'Idempotency-Key': input.idempotencyKey },
      ...(input.templateId ? { tags: [input.templateId] } : {}),
    });
    const providerReference = response.messageId ?? response.messageIds?.[0];
    if (!providerReference) {
      throw new ServiceUnavailableException('Brevo did not return an email message ID');
    }
    return { provider: this.name, providerReference, accepted: true };
  }
}
