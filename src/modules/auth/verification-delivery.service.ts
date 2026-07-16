import { Inject, Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  AccountVerificationChannel,
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationStatus,
} from '../../../generated/prisma/enums.js';
import type { Environment } from '../../config/env.schema.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { EMAIL_PROVIDER, type EmailProvider } from '../notifications/providers/email-provider.js';

interface DeliveryInput {
  readonly userId: string;
  readonly challengeId: string;
  readonly channel: AccountVerificationChannel;
  readonly destination: string;
  readonly destinationMasked: string;
  readonly code: string;
}

@Injectable()
export class VerificationDeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<Environment, true>,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
  ) {}

  async send(input: DeliveryInput): Promise<void> {
    const channel =
      input.channel === AccountVerificationChannel.EMAIL
        ? NotificationChannel.EMAIL
        : NotificationChannel.SMS;
    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        channel,
        template: `account-verification-${input.channel.toLowerCase()}`,
        dedupeKey: `account-verification:${input.challengeId}`,
        payload: { destination: input.destinationMasked, challengeId: input.challengeId },
      },
    });

    try {
      const result =
        input.channel === AccountVerificationChannel.EMAIL
          ? await this.emailProvider.send({
              to: input.destination,
              subject: 'Verify your Ajo Cloud email',
              text: `Your Ajo Cloud verification code is ${input.code}. It expires in 10 minutes.`,
              templateId: 'account-verification-email',
              variables: { code: input.code },
              idempotencyKey: input.challengeId,
            })
          : await this.sendSms(input);
      await this.prisma.$transaction([
        this.prisma.notification.update({
          where: { id: notification.id },
          data: { status: NotificationStatus.SENT, sentAt: new Date() },
        }),
        this.prisma.notificationDelivery.create({
          data: {
            notificationId: notification.id,
            provider: result.provider,
            providerReference: result.providerReference,
            status: NotificationDeliveryStatus.SENT,
            sentAt: new Date(),
          },
        }),
      ]);
    } catch (error: unknown) {
      await this.prisma.$transaction([
        this.prisma.notification.update({
          where: { id: notification.id },
          data: { status: NotificationStatus.FAILED },
        }),
        this.prisma.notificationDelivery.create({
          data: {
            notificationId: notification.id,
            provider: input.channel === AccountVerificationChannel.EMAIL ? 'email' : 'sms',
            status: NotificationDeliveryStatus.FAILED,
            failureCode: 'DELIVERY_UNAVAILABLE',
            failureReason: 'Verification delivery was not accepted',
          },
        }),
      ]);
      throw error;
    }
  }

  private sendSms(input: DeliveryInput): Promise<{
    provider: string;
    providerReference: string;
  }> {
    const provider = this.config.get('SMS_PROVIDER', { infer: true });
    if (provider !== 'mock') {
      throw new ServiceUnavailableException('SMS verification delivery is unavailable');
    }
    return Promise.resolve({ provider: 'mock', providerReference: input.challengeId });
  }
}
