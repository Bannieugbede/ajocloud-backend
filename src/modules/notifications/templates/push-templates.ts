import type { EmailTemplateKey } from './transactional-templates.js';

export interface RenderedPushTemplate {
  readonly title: string;
  readonly body: string;
  readonly version: number;
  /** In-app destination for a tap. A path, never a URL: a server-supplied
      external link that the client opens blindly is an open redirect. */
  readonly deepLink?: string;
}

type Variables = Readonly<Record<string, string>>;

/**
 * Short-form copy for push and in-app delivery.
 *
 * Separate from the email catalogue rather than derived from it: a push body is
 * read on a lock screen in a glance, so it must be short and must not carry
 * anything private. An email subject line makes a poor notification and an
 * email body makes an impossible one.
 *
 * Only product templates appear here. Security mail is email-only on purpose —
 * a push saying someone signed in is useful, but the recovery link itself must
 * go to a mailbox the attacker does not already hold.
 */
const PUSH_TEMPLATES: Partial<
  Record<EmailTemplateKey, (variables: Variables) => RenderedPushTemplate>
> = {
  'ajo-contribution-due': (variables) => ({
    title: 'Contribution due',
    body: `Your ${text(variables, 'groupName')} contribution of ${text(variables, 'amount')} is due ${text(variables, 'dueDate')}.`,
    version: 1,
    deepLink: '/(tabs)/ajo',
  }),
  'ajo-contribution-missed': (variables) => ({
    title: 'Contribution missed',
    body: `You missed a contribution for ${text(variables, 'groupName')}.`,
    version: 1,
    deepLink: '/(tabs)/ajo',
  }),
  'ajo-payout-sent': (variables) => ({
    title: 'Your payout was sent',
    body: `${text(variables, 'amount')} was sent for your ${text(variables, 'groupName')} payout.`,
    version: 1,
    deepLink: '/(tabs)/ajo',
  }),
  'ajo-group-invite': (variables) => ({
    title: 'Group invitation',
    body: `You were invited to join ${text(variables, 'groupName')}.`,
    version: 1,
    deepLink: '/(tabs)/ajo',
  }),
  'food-distribution-ready': (variables) => ({
    title: 'Your food is ready',
    body: `Collection for ${text(variables, 'programmeName')} is ready.`,
    version: 1,
    deepLink: '/(tabs)/food',
  }),
  'akawo-goal-progress': (variables) => ({
    title: 'Savings progress',
    body: `You are ${text(variables, 'progress')} of the way to ${text(variables, 'goalName')}.`,
    version: 1,
    deepLink: '/(tabs)/akawo',
  }),
  'akawo-goal-reached': (variables) => ({
    title: 'Goal reached',
    body: `You reached your ${text(variables, 'goalName')} goal.`,
    version: 1,
    deepLink: '/(tabs)/akawo',
  }),
  'bill-payment-receipt': (variables) => ({
    title: 'Bill paid',
    body: `Your ${text(variables, 'billerName')} payment of ${text(variables, 'amount')} went through.`,
    version: 1,
    deepLink: '/(tabs)/bills',
  }),
  'wallet-funded': (variables) => ({
    title: 'Wallet funded',
    body: `${text(variables, 'amount')} was added to your wallet.`,
    version: 1,
    deepLink: '/(tabs)/home',
  }),
  'withdrawal-processed': (variables) => ({
    title: 'Withdrawal sent',
    body: `${text(variables, 'amount')} is on its way to your bank.`,
    version: 1,
    deepLink: '/(tabs)/home',
  }),
  'kyc-approved': () => ({
    title: 'Verification complete',
    body: 'Your identity has been verified.',
    version: 1,
    deepLink: '/(tabs)/profile',
  }),
  'kyc-rejected': () => ({
    title: 'Verification needs attention',
    body: 'We could not verify your identity. Open the app to see what is needed.',
    version: 1,
    deepLink: '/(tabs)/profile',
  }),
};

/** Whether this template can be delivered as a push or in-app notification. */
export function hasPushTemplate(template: string): boolean {
  return template in PUSH_TEMPLATES;
}

export function renderPushTemplate(
  template: string,
  variables: Variables,
): RenderedPushTemplate | null {
  const render = PUSH_TEMPLATES[template as EmailTemplateKey];
  return render ? render(variables) : null;
}

/** Missing variables render as an empty string rather than throwing: a
    notification with a gap is better than a silent failure to notify. */
function text(variables: Variables, key: string): string {
  return variables[key] ?? '';
}
