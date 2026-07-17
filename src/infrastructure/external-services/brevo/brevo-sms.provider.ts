import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../config/env.schema.js';
import type {
  SendSmsInput,
  SmsDeliveryResult,
  SmsProvider,
} from '../../../modules/notifications/providers/sms-provider.js';
import { BrevoClientService } from './brevo-client.service.js';

@Injectable()
export class BrevoSmsProvider implements SmsProvider {
  readonly name = 'brevo';
  private readonly sender: string;

  constructor(
    private readonly brevo: BrevoClientService,
    config: ConfigService<Environment, true>,
  ) {
    this.sender = config.get('BREVO_SMS_SENDER', { infer: true }) ?? '';
  }

  async send(input: SendSmsInput): Promise<SmsDeliveryResult> {
    if (!this.sender) throw new ServiceUnavailableException('Brevo SMS sender is not configured');
    const response = await this.brevo.sendSms({
      recipient: input.to,
      sender: this.sender,
      content: input.content,
      type: 'transactional',
      tag: input.templateId,
      unicodeEnabled: [...input.content].some((character) => (character.codePointAt(0) ?? 0) > 127),
    });
    return {
      provider: this.name,
      providerReference: String(response.messageId),
      accepted: true,
    };
  }
}
