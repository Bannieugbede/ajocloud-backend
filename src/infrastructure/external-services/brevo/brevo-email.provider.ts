import { Injectable, NotImplementedException } from '@nestjs/common';
import type {
  EmailDeliveryResult,
  EmailProvider,
} from '../../../modules/notifications/providers/email-provider.js';

@Injectable()
export class BrevoEmailProvider implements EmailProvider {
  send(): Promise<EmailDeliveryResult> {
    throw new NotImplementedException(
      'Brevo is under consideration and requires approved current API requirements',
    );
  }
}
