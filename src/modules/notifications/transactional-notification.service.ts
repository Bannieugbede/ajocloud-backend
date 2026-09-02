import { Inject, Injectable } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationDeliveryStatus,
  NotificationStatus,
} from '../../../generated/prisma/enums.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { DevicesService } from '../devices/devices.service.js';
import { decideDelivery, type SuppressionReason } from './domain/notification-policy.js';
import { PUSH_PROVIDER, type PushProvider } from './providers/push-provider.js';
import { renderPushTemplate } from './templates/push-templates.js';
import { topicForTemplate } from './domain/notification-topics.js';
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
  | { readonly status: 'SENT'; readonly providerReference: string }
  | { readonly status: 'FAILED' }
  /**
   * The user declined this topic, or it arrived inside their quiet hours.
   * Distinct from FAILED: nothing went wrong, so a caller must not retry or
   * treat it as an outage.
   */
  | { readonly status: 'SUPPRESSED'; readonly reason: SuppressionReason };

@Injectable()
export class TransactionalNotificationService {
  constructor(
    private readonly prisma: PrismaService,
    @Inject(EMAIL_PROVIDER) private readonly emailProvider: EmailProvider,
    @Inject(SMS_PROVIDER) private readonly smsProvider: SmsProvider,
    @Inject(PUSH_PROVIDER) private readonly pushProvider: PushProvider,
    private readonly devices: DevicesService,
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

  /**
   * Sends a product notification as a push, an in-app entry, or both.
   *
   * The in-app row is written even when push fails or the user has no device:
   * the app's own inbox is the reliable channel, and push is a prompt to open
   * it rather than the notification itself. Delivering only by push would mean
   * a person who declined permission never learns their payout arrived.
   */
  async notify(input: {
    readonly userId: string;
    readonly template: string;
    readonly variables: Readonly<Record<string, string>>;
    readonly storedPayload: Readonly<Record<string, string>>;
    readonly dedupeKey: string;
  }): Promise<{ readonly inApp: boolean; readonly pushed: number }> {
    const rendered = renderPushTemplate(input.template, input.variables);
    if (!rendered) return { inApp: false, pushed: 0 };

    const inAppSuppressed = await this.suppressionFor(
      input.userId,
      input.template,
      NotificationChannel.IN_APP,
    );
    let inApp = false;
    if (!inAppSuppressed) {
      try {
        await this.prisma.notification.create({
          data: {
            userId: input.userId,
            channel: NotificationChannel.IN_APP,
            template: input.template,
            templateVersion: rendered.version,
            dedupeKey: `${input.dedupeKey}:in-app`,
            payload: input.storedPayload,
            title: rendered.title,
            body: rendered.body,
            ...(rendered.deepLink ? { deepLink: rendered.deepLink } : {}),
            status: NotificationStatus.SENT,
            sentAt: new Date(),
          },
        });
        inApp = true;
      } catch {
        // A duplicate dedupe key means this event was already recorded, which
        // is the intended outcome rather than a failure.
        inApp = false;
      }
    }

    const pushSuppressed = await this.suppressionFor(
      input.userId,
      input.template,
      NotificationChannel.PUSH,
    );
    if (pushSuppressed) return { inApp, pushed: 0 };

    const tokens = await this.devices.pushTokensFor(input.userId);
    if (tokens.length === 0) return { inApp, pushed: 0 };

    const delivery = await this.pushProvider.send({
      to: tokens,
      title: rendered.title,
      body: rendered.body,
      // Only what the app needs to route the tap. Push payloads travel through
      // Apple's and Google's infrastructure and show on a lock screen, so
      // nothing sensitive goes here.
      data: rendered.deepLink ? { deepLink: rendered.deepLink } : {},
      idempotencyKey: input.dedupeKey,
    });

    for (const result of delivery.results) {
      // Expo says this token is permanently dead, so it is released rather than
      // retried forever against a handset that no longer has the app.
      if (result.unregistered) await this.devices.releaseUnregisteredToken(result.token);
    }
    return { inApp, pushed: delivery.results.filter((result) => result.accepted).length };
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
    const suppression = await this.suppressionFor(input.userId, input.template, input.channel);
    if (suppression) return { status: 'SUPPRESSED', reason: suppression };

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

  /**
   * The reason this message must not be delivered, or null to proceed.
   *
   * Security and account-recovery templates carry no topic and are never
   * suppressed: someone who had switched off password-reset mail could not
   * recover their account, and a login alert held until morning is not an alert.
   *
   * A suppressed message writes no `Notification` row. The record exists to
   * describe delivery, and a message that was never attempted has none; storing
   * one would also consume the dedupe key, so a later permitted send of the same
   * event would be silently swallowed as a duplicate.
   */
  private async suppressionFor(
    userId: string,
    template: string,
    channel: NotificationChannel,
  ): Promise<SuppressionReason | null> {
    const topic = topicForTemplate(template);
    if (topic === null) return null;
    const preference = await this.prisma.notificationPreference.findUnique({
      where: { userId_channel_topic: { userId, channel, topic } },
      select: {
        enabled: true,
        quietHoursStartMinutes: true,
        quietHoursEndMinutes: true,
        timezone: true,
      },
    });
    const decision = decideDelivery({ topic, preference, now: new Date() });
    return decision.send ? null : (decision.reason ?? null);
  }
}
