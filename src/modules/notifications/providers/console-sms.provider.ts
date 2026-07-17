import { Injectable, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import type { SendSmsInput, SmsDeliveryResult, SmsProvider } from './sms-provider.js';

@Injectable()
export class ConsoleSmsProvider implements SmsProvider {
  readonly name = 'mock';
  private readonly logger = new Logger(ConsoleSmsProvider.name);

  send(input: SendSmsInput): Promise<SmsDeliveryResult> {
    const providerReference = createHash('sha256').update(input.idempotencyKey).digest('hex');
    this.logger.log({
      event: 'development_sms_accepted',
      providerReference,
      recipientSuffix: input.to.slice(-4),
      templateId: input.templateId,
    });
    return Promise.resolve({ provider: this.name, providerReference, accepted: true });
  }
}
