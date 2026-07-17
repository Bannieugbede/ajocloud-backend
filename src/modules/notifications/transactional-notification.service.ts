import { Inject, Injectable } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationStatus,
} from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { EMAIL_PROVIDER, type EmailProvider } from './providers/email-provider.js';
import { SMS_PROVIDER, type SmsProvider } from './providers/sms-provider.js';
import {
  renderEmailTemplate,
  renderSmsTemplate,
  type EmailTemplateKey,
  type SmsTemplateKey,
} from './templates/transactional-templates.js';

interface NotificationInput {
  readonly userId: string;
  readonly destination: string;
  readonly variables: Readonly<Record<string, string>>;
  readonly storedPayload: Readonly<Record<string, string>>;
  readonly dedupeKey: string;
}

export type NotificationDeliveryOutcome =
  { readonly status: 'SENT'; readonly providerReference: string } | { readonly status: 'FAILED' };

@Injectable()
export class TransactionalNotificationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
  ) {}

  async sendEmail(
    input: NotificationInput & { readonly template: EmailTemplateKey },
  ): Promise<NotificationDeliveryOutcome> {
    const rendered = renderEmailTemplate(input.template, input.variables);
    return this.deliver({
      ...input,
      channel: NotificationChannel.EMAIL,
      templateVersion: rendered.version,
      providerName: this.emailProvider.name,
      send: () =>
        this.emailProvider.send({
          to: input.destination,
          subject: rendered.subject,
          html: rendered.html,
          text: rendered.text,
          templateId: rendered.key,
          variables: input.variables,
          idempotencyKey: input.dedupeKey,
        }),
    });
  }

  async sendSms(
    input: NotificationInput & { readonly template: SmsTemplateKey },
  ): Promise<NotificationDeliveryOutcome> {
    const rendered = renderSmsTemplate(input.template, input.variables);
    return this.deliver({
      ...input,
      channel: NotificationChannel.SMS,
      templateVersion: rendered.version,
      providerName: this.smsProvider.name,
      send: () =>
        this.smsProvider.send({
          to: input.destination,
          content: rendered.content,
          templateId: rendered.key,
          idempotencyKey: input.dedupeKey,
        }),
    });
  }

  private async deliver(input: {
    readonly userId: string;
    readonly template: string;
    readonly channel: NotificationChannel;
    readonly templateVersion: number;
    readonly storedPayload: Readonly<Record<string, string>>;
    readonly dedupeKey: string;
    readonly providerName: string;
    readonly send: () => Promise<{
      readonly provider: string;
      readonly providerReference: string;
      readonly accepted: boolean;
    }>;
  }): Promise<NotificationDeliveryOutcome> {
    const existing = await this.prisma.notification.findUnique({
      where: { dedupeKey: input.dedupeKey },
    });
    if (existing) {
      return existing.status === NotificationStatus.SENT ||
        existing.status === NotificationStatus.DELIVERED
        ? {
            status: 'SENT',
            providerReference: `deduplicated:${existing.id}`,
          }
        : { status: 'FAILED' };
    }
    const notification = await this.prisma.notification.create({
      data: {
        userId: input.userId,
        channel: input.channel,
        template: input.template,
        templateVersion: input.templateVersion,
        dedupeKey: input.dedupeKey,
        payload: input.storedPayload,
      },
    });
    try {
      const result = await input.send();
      if (!result.accepted) throw new Error('provider did not accept message');
      const sentAt = new Date();
      await this.prisma.$transaction([
        this.prisma.notification.update({
          where: { id: notification.id },
          data: { status: NotificationStatus.SENT, sentAt },
        }),
        this.prisma.notificationDelivery.create({
          data: {
            notificationId: notification.id,
            provider: result.provider,
            providerReference: result.providerReference,
            status: NotificationDeliveryStatus.SENT,
            sentAt,
          },
        }),
      ]);
      return { status: 'SENT', providerReference: result.providerReference };
    } catch {
      await this.prisma.$transaction([
        this.prisma.notification.update({
          where: { id: notification.id },
          data: { status: NotificationStatus.FAILED },
        }),
        this.prisma.notificationDelivery.create({
          data: {
            notificationId: notification.id,
            provider: input.providerName,
            status: NotificationDeliveryStatus.FAILED,
            failureCode: 'DELIVERY_UNAVAILABLE',
            failureReason: 'Transactional notification delivery was not accepted',
          },
        }),
      ]);
      return { status: 'FAILED' };
    }
  }
}
