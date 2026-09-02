import type { EmailTemplateKey, SmsTemplateKey } from '../templates/transactional-templates.js';

/**
 * The closed set of topics a user can express a preference about.
 *
 * A fixed catalog rather than free text: `NotificationPreference.topic` is a
 * plain string column, so a client typo would otherwise store a row that looks
 * saved in the UI but governs nothing and is never read.
 */
export const NOTIFICATION_TOPICS = [
  'ajo.contribution',
  'ajo.payout',
  'ajo.membership',
  'akawo.progress',
  'food.distribution',
  'bills.receipt',
  'wallet.activity',
  'kyc.status',
] as const;

export type NotificationTopic = (typeof NOTIFICATION_TOPICS)[number];

/**
 * Templates that carry security or account-recovery meaning. These are sent
 * whatever the user's preferences say and are never held back by quiet hours.
 *
 * Someone who switched off password-reset mail could not recover their account,
 * and a login alert that arrives eight hours late is not an alert. Because they
 * cannot be declined, they are deliberately absent from the topic catalog above:
 * offering a switch that does nothing is worse than offering none.
 */
const ALWAYS_SEND: ReadonlySet<string> = new Set<EmailTemplateKey | SmsTemplateKey>([
  'account-verification-email',
  'sign-in-code',
  'welcome',
  'password-reset',
  'password-reset-sms',
  'password-changed',
  'new-login-alert',
  'device-added',
  'account-locked',
  'staff-invite',
]);

/**
 * Which topic governs each template. Every template is listed: an unmapped one
 * would silently bypass preferences, so `topicForTemplate` treats absence from
 * both this map and ALWAYS_SEND as a programming error rather than as consent.
 */
const TEMPLATE_TOPICS: Readonly<Record<string, NotificationTopic>> = {
  'kyc-approved': 'kyc.status',
  'kyc-rejected': 'kyc.status',
  'wallet-funded': 'wallet.activity',
  'withdrawal-processed': 'wallet.activity',
  'ajo-contribution-due': 'ajo.contribution',
  'ajo-contribution-missed': 'ajo.contribution',
  'ajo-payout-sent': 'ajo.payout',
  'ajo-group-invite': 'ajo.membership',
  'food-distribution-ready': 'food.distribution',
  'akawo-goal-progress': 'akawo.progress',
  'akawo-goal-reached': 'akawo.progress',
  'bill-payment-receipt': 'bills.receipt',
};

export function isNotificationTopic(value: string): value is NotificationTopic {
  return (NOTIFICATION_TOPICS as readonly string[]).includes(value);
}

/** True when the template must be delivered regardless of preference. */
export function isAlwaysSent(template: string): boolean {
  return ALWAYS_SEND.has(template);
}

/**
 * The topic governing a template, or null when it is always sent.
 *
 * Throws for an unknown template rather than defaulting: a new template that
 * nobody classified should fail loudly in tests, not quietly become
 * unsuppressible or silently suppressed.
 */
export function topicForTemplate(template: string): NotificationTopic | null {
  if (isAlwaysSent(template)) return null;
  const topic = TEMPLATE_TOPICS[template];
  if (!topic) {
    throw new Error(`Template "${template}" is not mapped to a notification topic`);
  }
  return topic;
}
