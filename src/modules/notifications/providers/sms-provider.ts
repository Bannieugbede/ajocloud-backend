export interface SendSmsInput {
  readonly to: string;
  readonly content: string;
  readonly templateId: string;
  readonly idempotencyKey: string;
}

export interface SmsDeliveryResult {
  readonly provider: string;
  readonly providerReference: string;
  readonly accepted: boolean;
}

export interface SmsProvider {
  readonly name: string;
  send(input: SendSmsInput): Promise<SmsDeliveryResult>;
}

export const SMS_PROVIDER = Symbol('SMS_PROVIDER');
