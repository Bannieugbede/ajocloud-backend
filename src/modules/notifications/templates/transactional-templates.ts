export type EmailTemplateKey =
  | 'account-verification-email'
  | 'welcome'
  | 'password-reset'
  | 'password-changed'
  | 'new-login-alert'
  | 'ajo-contribution-due'
  | 'ajo-payout-sent'
  | 'food-distribution-ready'
  | 'akawo-goal-progress'
  | 'bill-payment-receipt';

export type SmsTemplateKey = 'password-reset-sms';

export interface RenderedEmailTemplate {
  readonly key: EmailTemplateKey;
  readonly version: number;
  readonly subject: string;
  readonly html: string;
  readonly text: string;
}

export interface RenderedSmsTemplate {
  readonly key: SmsTemplateKey;
  readonly version: number;
  readonly content: string;
}

type Variables = Readonly<Record<string, string>>;
type EmailDefinition = (variables: Variables) => Omit<RenderedEmailTemplate, 'key' | 'version'>;

const emailDefinitions: Record<EmailTemplateKey, EmailDefinition> = {
  'account-verification-email': (variables) => {
    const code = required(variables, 'code');
    return email(
      'Verify your email',
      'Your Ajo Cloud verification code',
      `Use this verification code to finish setting up your account:`,
      `<div style="font-size:32px;font-weight:700;letter-spacing:8px;color:#0D47A1;margin:24px 0">${escapeHtml(code)}</div>
       <p style="margin:0 0 16px">This code expires in ${escapeHtml(required(variables, 'expiresMinutes'))} minutes. Never share it with anyone.</p>`,
      `Your Ajo Cloud verification code is ${code}. It expires in ${required(variables, 'expiresMinutes')} minutes. Never share this code.`,
    );
  },
  welcome: (variables) =>
    email(
      'Welcome to Ajo Cloud',
      'Your Ajo Cloud account is ready',
      `Hi ${escapeHtml(required(variables, 'firstName'))}, your account is verified and ready.`,
      `<p style="margin:0 0 16px">You can now securely manage your Ajo groups, Akawo goals, Food Ajo plans, and wallet from one place.</p>
       <p style="margin:0">We will always ask you to verify sensitive actions and will never request your password or verification code by email.</p>`,
      `Hi ${required(variables, 'firstName')}, welcome to Ajo Cloud. Your verified account is ready. You can now manage your Ajo groups, Akawo goals, Food Ajo plans, and wallet.`,
    ),
  'password-reset': (variables) =>
    actionEmail(
      'Reset your password',
      'A password reset was requested for your Ajo Cloud account.',
      'Reset password',
      required(variables, 'resetUrl'),
      `This link expires in ${required(variables, 'expiresMinutes')} minutes. If you did not request this, ignore this email and review your account security.`,
    ),
  'password-changed': (variables) =>
    email(
      'Your password was changed',
      'Ajo Cloud password changed',
      `Hi ${escapeHtml(required(variables, 'firstName'))}, your password was changed successfully.`,
      `<p style="margin:0">If this was not you, contact support immediately and revoke your active sessions.</p>`,
      `Hi ${required(variables, 'firstName')}, your Ajo Cloud password was changed. If this was not you, contact support immediately.`,
    ),
  'new-login-alert': (variables) =>
    email(
      'New sign-in to your account',
      'A new Ajo Cloud sign-in was detected',
      `We noticed a new sign-in on ${escapeHtml(required(variables, 'occurredAt'))}.`,
      `<p style="margin:0 0 8px"><strong>Device:</strong> ${escapeHtml(required(variables, 'device'))}</p>
       <p style="margin:0">If this was not you, change your password and revoke all sessions immediately.</p>`,
      `New Ajo Cloud sign-in on ${required(variables, 'occurredAt')} from ${required(variables, 'device')}. If this was not you, secure your account immediately.`,
    ),
  'ajo-contribution-due': (variables) =>
    email(
      `Contribution due for ${required(variables, 'groupName')}`,
      'An Ajo contribution is due',
      `Your ${escapeHtml(required(variables, 'amount'))} contribution to ${escapeHtml(required(variables, 'groupName'))} is due ${escapeHtml(required(variables, 'dueDate'))}.`,
      `<p style="margin:0">Open Ajo Cloud to review the cycle and complete the authorized payment flow.</p>`,
      `Your ${required(variables, 'amount')} contribution to ${required(variables, 'groupName')} is due ${required(variables, 'dueDate')}.`,
    ),
  'ajo-payout-sent': (variables) =>
    email(
      'Your Ajo payout was sent',
      'Ajo payout update',
      `${escapeHtml(required(variables, 'amount'))} was sent for your ${escapeHtml(required(variables, 'groupName'))} payout.`,
      `<p style="margin:0">Reference: <strong>${escapeHtml(required(variables, 'reference'))}</strong></p>`,
      `${required(variables, 'amount')} was sent for your ${required(variables, 'groupName')} payout. Reference: ${required(variables, 'reference')}.`,
    ),
  'food-distribution-ready': (variables) =>
    email(
      'Your Food Ajo package is ready',
      'Food Ajo distribution update',
      `Your ${escapeHtml(required(variables, 'programmeName'))} package is ready for distribution.`,
      `<p style="margin:0"><strong>Pickup:</strong> ${escapeHtml(required(variables, 'pickupDate'))}</p>`,
      `Your ${required(variables, 'programmeName')} Food Ajo package is ready. Pickup: ${required(variables, 'pickupDate')}.`,
    ),
  'akawo-goal-progress': (variables) =>
    email(
      `Progress on ${required(variables, 'goalName')}`,
      'Akawo savings progress',
      `You have reached ${escapeHtml(required(variables, 'progress'))} of your ${escapeHtml(required(variables, 'goalName'))} goal.`,
      `<p style="margin:0">Keep going—review your goal in Ajo Cloud for the authoritative balance and schedule.</p>`,
      `You have reached ${required(variables, 'progress')} of your ${required(variables, 'goalName')} Akawo goal.`,
    ),
  'bill-payment-receipt': (variables) =>
    email(
      `Receipt for ${required(variables, 'serviceName')}`,
      'Bill payment receipt',
      `Your ${escapeHtml(required(variables, 'amount'))} payment for ${escapeHtml(required(variables, 'serviceName'))} was successful.`,
      `<p style="margin:0"><strong>Reference:</strong> ${escapeHtml(required(variables, 'reference'))}</p>`,
      `Your ${required(variables, 'amount')} payment for ${required(variables, 'serviceName')} was successful. Reference: ${required(variables, 'reference')}.`,
    ),
};

export const EMAIL_TEMPLATE_KEYS = Object.freeze(
  Object.keys(emailDefinitions) as EmailTemplateKey[],
);
export const SMS_TEMPLATE_KEYS = Object.freeze([
  'password-reset-sms',
] as const satisfies readonly SmsTemplateKey[]);

export function renderEmailTemplate(
  key: EmailTemplateKey,
  variables: Variables,
): RenderedEmailTemplate {
  return { key, version: 1, ...emailDefinitions[key](variables) };
}

export function renderSmsTemplate(key: SmsTemplateKey, variables: Variables): RenderedSmsTemplate {
  const content = `Reset your Ajo Cloud password: ${required(variables, 'resetUrl')}. This link expires in ${required(variables, 'expiresMinutes')} minutes.`;
  return { key, version: 1, content };
}

function required(variables: Variables, key: string): string {
  const value = variables[key]?.trim();
  if (!value) throw new Error(`Missing template variable: ${key}`);
  return value;
}

function email(
  subject: string,
  preheader: string,
  heading: string,
  body: string,
  text: string,
): Omit<RenderedEmailTemplate, 'key' | 'version'> {
  return {
    subject,
    text,
    html: layout(preheader, heading, body),
  };
}

function actionEmail(
  subject: string,
  heading: string,
  actionLabel: string,
  actionUrl: string,
  detail: string,
): Omit<RenderedEmailTemplate, 'key' | 'version'> {
  const safeUrl = escapeHtml(actionUrl);
  return email(
    subject,
    subject,
    heading,
    `<p style="margin:0 0 24px">${escapeHtml(detail)}</p>
     <a href="${safeUrl}" style="display:inline-block;background:#0D47A1;color:#ffffff;text-decoration:none;font-weight:600;padding:12px 20px;border-radius:8px">${escapeHtml(actionLabel)}</a>`,
    `${heading} ${detail} ${actionLabel}: ${actionUrl}`,
  );
}

function layout(preheader: string, heading: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(preheader)}</title></head>
<body style="margin:0;background:#f4f7fb;color:#172033;font-family:Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fb;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid #dce3ee;border-radius:12px;overflow:hidden">
        <tr><td style="background:#0D47A1;color:#ffffff;padding:20px 28px;font-size:22px;font-weight:700">Ajo Cloud</td></tr>
        <tr><td style="padding:32px 28px">
          <h1 style="font-size:24px;line-height:1.3;margin:0 0 16px;color:#172033">${heading}</h1>
          ${body}
        </td></tr>
        <tr><td style="border-top:1px solid #dce3ee;padding:20px 28px;color:#667085;font-size:12px;line-height:1.5">This is a transactional message from Ajo Cloud. Never share passwords, PINs, or verification codes.</td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
