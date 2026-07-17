import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { TransactionalNotificationService } from '../notifications/transactional-notification.service.js';

interface DeliveryInput {
  readonly userId: string;
  readonly challengeId: string;
  readonly destination: string;
  readonly destinationMasked: string;
  readonly code: string;
}

@Injectable()
export class VerificationDeliveryService {
  constructor(private readonly notifications: TransactionalNotificationService) {}

  async send(input: DeliveryInput): Promise<void> {
    const common = {
      userId: input.userId,
      destination: input.destination,
      variables: { code: input.code, expiresMinutes: '10' },
      storedPayload: {
        destination: input.destinationMasked,
        challengeId: input.challengeId,
      },
      dedupeKey: `account-verification:${input.challengeId}`,
    } as const;
    const outcome = await this.notifications.sendEmail({
      ...common,
      template: 'account-verification-email',
    });
    if (outcome.status === 'FAILED') {
      throw new ServiceUnavailableException('Verification delivery is unavailable');
    }
  }
}
