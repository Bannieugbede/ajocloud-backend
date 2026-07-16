import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { EmailDeliveryResult, EmailProvider, SendEmailInput } from './email-provider.js';

@Injectable()
export class ConsoleEmailProvider implements EmailProvider {
  private readonly logger = new Logger(ConsoleEmailProvider.name);

  send(input: SendEmailInput): Promise<EmailDeliveryResult> {
    const providerReference = createHash('sha256').update(input.idempotencyKey).digest('hex');
    this.logger.log({
      event: 'development_email_accepted',
      providerReference,
      recipientDomain: input.to.split('@')[1] ?? 'invalid',
      templateId: input.templateId,
    });
    return Promise.resolve({ provider: 'console', providerReference, accepted: true });
  }
}
