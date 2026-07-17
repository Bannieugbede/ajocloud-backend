import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { BrevoClient, type Brevo } from '@getbrevo/brevo';
import type { Environment } from '../../../config/env.schema.js';

@Injectable()
export class BrevoClientService {
  private readonly client?: BrevoClient;

  constructor(config: ConfigService<Environment, true>) {
    const apiKey = config.get('BREVO_API_KEY', { infer: true });
    if (!apiKey) return;
    const baseUrl = config.get('BREVO_BASE_URL', { infer: true });
    this.client = new BrevoClient({
      apiKey,
      timeoutInSeconds: 15,
      maxRetries: 2,
      ...(baseUrl ? { baseUrl } : {}),
    });
  }

  sendEmail(input: Brevo.SendTransacEmailRequest): Promise<Brevo.SendTransacEmailResponse> {
    return this.getClient().transactionalEmails.sendTransacEmail(input);
  }

  sendSms(input: Brevo.SendTransacSms): Promise<Brevo.SendAsyncTransactionalSmsResponse> {
    return this.getClient().transactionalSms.sendAsyncTransactionalSms(input);
  }

  private getClient(): BrevoClient {
    if (!this.client) throw new ServiceUnavailableException('Brevo is not configured');
    return this.client;
  }
}
