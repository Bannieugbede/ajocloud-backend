export interface SendEmailInput {
  readonly to: string;
  readonly subject: string;
  readonly html?: string;
  readonly text?: string;
  readonly templateId?: string;
  readonly variables?: Readonly<Record<string, string>>;
  readonly idempotencyKey: string;
}

export interface EmailDeliveryResult {
  readonly provider: string;
  readonly providerReference: string;
  readonly accepted: boolean;
}

export interface EmailProvider {
  send(input: SendEmailInput): Promise<EmailDeliveryResult>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
