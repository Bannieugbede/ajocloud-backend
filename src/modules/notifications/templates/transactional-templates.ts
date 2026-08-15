export type EmailTemplateKey =
  | 'account-verification-email'
  | 'sign-in-code'
  | 'welcome'
  | 'password-reset'
  | 'password-changed'
  | 'new-login-alert'
  | 'device-added'
  | 'account-locked'
  | 'kyc-approved'
  | 'kyc-rejected'
  | 'wallet-funded'
  | 'withdrawal-processed'
  | 'ajo-contribution-due'
  | 'ajo-contribution-missed'
  | 'ajo-payout-sent'
  | 'ajo-group-invite'
  | 'food-distribution-ready'
  | 'akawo-goal-progress'
  | 'akawo-goal-reached'
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
    const expires = required(variables, 'expiresMinutes');
    return email(
      'Verify your email',
      'Your Ajo Cloud verification code',
      'Verify your email',
      `${paragraph('Use this code to finish setting up your Ajo Cloud account.')}
       ${codeBlock(code)}
       ${muted(`This code expires in ${escapeHtml(expires)} minutes.`)}
       ${securityNote('Ajo Cloud will never ask you for this code. If you did not create an account, ignore this email.')}`,
      `Your Ajo Cloud verification code is ${code}. It expires in ${expires} minutes. Never share this code.`,
    );
  },
  'sign-in-code': (variables) => {
    const code = required(variables, 'code');
    const expires = required(variables, 'expiresMinutes');
    return email(
      'Your Ajo Cloud sign-in code',
      'Your Ajo Cloud sign-in code',
      'Sign in to Ajo Cloud',
      `${paragraph('Enter this code to finish signing in.')}
       ${codeBlock(code)}
       ${muted(`This code expires in ${escapeHtml(expires)} minutes and can only be used once.`)}
       ${securityNote('If you did not try to sign in, you can safely ignore this email. Nobody can access your account without this code.')}`,
      `Your Ajo Cloud sign-in code is ${code}. It expires in ${expires} minutes. Never share this code. If you did not try to sign in, ignore this email.`,
    );
  },
  welcome: (variables) => {
    const firstName = required(variables, 'firstName');
    return email(
      'Welcome to Ajo Cloud',
      'Your Ajo Cloud account is ready',
      `Welcome, ${escapeHtml(firstName)}`,
      `${paragraph('Your account is verified and ready to use. Everything you need is now in one place:')}
       ${bullets([
         '<strong>Ajo groups</strong> — rotate contributions with people you trust',
         '<strong>Akawo</strong> — set a target and save towards it',
         '<strong>Food Ajo</strong> — pool towards food packages',
         '<strong>Bills &amp; wallet</strong> — pay and track from one balance',
       ])}
       ${securityNote('We will always ask you to verify sensitive actions, and will never request your password or verification code by email.')}`,
      `Hi ${firstName}, welcome to Ajo Cloud. Your verified account is ready. You can now manage your Ajo groups, Akawo goals, Food Ajo plans, and wallet.`,
    );
  },
  'password-reset': (variables) => {
    const expires = required(variables, 'expiresMinutes');
    return actionEmail(
      'Reset your password',
      'Reset your password',
      'A password reset was requested for your Ajo Cloud account.',
      'Reset password',
      required(variables, 'resetUrl'),
      `This link expires in ${expires} minutes and can only be used once.`,
      'If you did not request a reset, ignore this email and review your account security. Your current password stays active.',
    );
  },
  'password-changed': (variables) => {
    const firstName = required(variables, 'firstName');
    return email(
      'Your password was changed',
      'Ajo Cloud password changed',
      'Your password was changed',
      `${paragraph(`Hi ${escapeHtml(firstName)}, your Ajo Cloud password was changed successfully.`)}
       ${alert('If this was not you, contact support immediately and revoke your active sessions.')}`,
      `Hi ${firstName}, your Ajo Cloud password was changed. If this was not you, contact support immediately.`,
    );
  },
  'new-login-alert': (variables) => {
    const occurredAt = required(variables, 'occurredAt');
    const device = required(variables, 'device');
    return email(
      'New sign-in to your account',
      'A new Ajo Cloud sign-in was detected',
      'New sign-in detected',
      `${paragraph('We noticed a new sign-in to your Ajo Cloud account.')}
       ${detailRows([
         ['When', occurredAt],
         ['Device', device],
       ])}
       ${alert('If this was not you, change your password and revoke all sessions immediately.')}`,
      `New Ajo Cloud sign-in on ${occurredAt} from ${device}. If this was not you, secure your account immediately.`,
    );
  },
  'device-added': (variables) => {
    const device = required(variables, 'device');
    const occurredAt = required(variables, 'occurredAt');
    return email(
      'A new device was added',
      'A new device now has access to your account',
      'New device added',
      `${paragraph('A new device was linked to your Ajo Cloud account.')}
       ${detailRows([
         ['Device', device],
         ['Added', occurredAt],
       ])}
       ${alert('If you did not add this device, remove it in the app under Security and change your password.')}`,
      `A new device (${device}) was added to your Ajo Cloud account on ${occurredAt}. If this was not you, remove it and change your password.`,
    );
  },
  'account-locked': (variables) => {
    const reason = required(variables, 'reason');
    return email(
      'Your account is temporarily locked',
      'Ajo Cloud account locked',
      'Account temporarily locked',
      `${paragraph('We locked your Ajo Cloud account to protect it.')}
       ${detailRows([['Reason', reason]])}
       ${paragraph('Your money is safe. Reset your password to restore access.')}
       ${securityNote('If you need help, contact support from the app rather than replying to this email.')}`,
      `Your Ajo Cloud account was temporarily locked (${reason}). Your funds are safe. Reset your password to restore access.`,
    );
  },
  'kyc-approved': (variables) => {
    const firstName = required(variables, 'firstName');
    return email(
      'Your identity has been verified',
      'KYC verification approved',
      'You are verified',
      `${paragraph(`Hi ${escapeHtml(firstName)}, your identity check passed. Your account limits have been raised.`)}
       ${paragraph('You can now join and create Ajo groups, request payouts, and withdraw to your bank.')}`,
      `Hi ${firstName}, your Ajo Cloud identity verification was approved. Your account limits have been raised.`,
    );
  },
  'kyc-rejected': (variables) => {
    const firstName = required(variables, 'firstName');
    const reason = required(variables, 'reason');
    return email(
      'We could not verify your identity',
      'KYC verification needs attention',
      'Identity check unsuccessful',
      `${paragraph(`Hi ${escapeHtml(firstName)}, we could not complete your identity verification.`)}
       ${detailRows([['Reason', reason]])}
       ${paragraph('Open Ajo Cloud and submit your documents again. Make sure the photo is clear and every corner is visible.')}`,
      `Hi ${firstName}, we could not verify your identity: ${reason}. Please resubmit your documents in the Ajo Cloud app.`,
    );
  },
  'wallet-funded': (variables) => {
    const amount = required(variables, 'amount');
    const reference = required(variables, 'reference');
    return email(
      'Wallet funded',
      'Your Ajo Cloud wallet was funded',
      'Wallet funded',
      `${paragraph(`${escapeHtml(amount)} was added to your Ajo Cloud wallet.`)}
       ${detailRows([
         ['Amount', amount],
         ['Reference', reference],
         ['Balance', required(variables, 'balance')],
       ])}`,
      `${amount} was added to your Ajo Cloud wallet. Reference: ${reference}. New balance: ${required(variables, 'balance')}.`,
    );
  },
  'withdrawal-processed': (variables) => {
    const amount = required(variables, 'amount');
    const reference = required(variables, 'reference');
    return email(
      'Withdrawal processed',
      'Your Ajo Cloud withdrawal is on its way',
      'Withdrawal sent',
      `${paragraph(`${escapeHtml(amount)} is on its way to your bank account.`)}
       ${detailRows([
         ['Amount', amount],
         ['Destination', required(variables, 'destination')],
         ['Reference', reference],
       ])}
       ${muted('Bank settlement usually completes within minutes, but can take up to 24 hours.')}`,
      `${amount} withdrawal to ${required(variables, 'destination')} was processed. Reference: ${reference}.`,
    );
  },
  'ajo-contribution-due': (variables) => {
    const amount = required(variables, 'amount');
    const groupName = required(variables, 'groupName');
    const dueDate = required(variables, 'dueDate');
    return email(
      `Contribution due for ${groupName}`,
      'An Ajo contribution is due',
      'Contribution due',
      `${paragraph(`Your contribution to <strong>${escapeHtml(groupName)}</strong> is due soon.`)}
       ${detailRows([
         ['Group', groupName],
         ['Amount', amount],
         ['Due', dueDate],
       ])}
       ${paragraph('Open Ajo Cloud to review the cycle and complete your payment.')}`,
      `Your ${amount} contribution to ${groupName} is due ${dueDate}.`,
    );
  },
  'ajo-contribution-missed': (variables) => {
    const groupName = required(variables, 'groupName');
    const amount = required(variables, 'amount');
    return email(
      `Missed contribution for ${groupName}`,
      'You missed an Ajo contribution',
      'Contribution missed',
      `${paragraph(`Your contribution to <strong>${escapeHtml(groupName)}</strong> was not received in time.`)}
       ${detailRows([
         ['Group', groupName],
         ['Amount', amount],
         ['Was due', required(variables, 'dueDate')],
       ])}
       ${alert('Pay as soon as you can to stay in good standing and keep your place in the payout order.')}`,
      `You missed your ${amount} contribution to ${groupName}, due ${required(variables, 'dueDate')}. Pay soon to stay in good standing.`,
    );
  },
  'ajo-payout-sent': (variables) => {
    const amount = required(variables, 'amount');
    const groupName = required(variables, 'groupName');
    const reference = required(variables, 'reference');
    return email(
      'Your Ajo payout was sent',
      'Ajo payout update',
      'Payout sent',
      `${paragraph(`It is your turn — <strong>${escapeHtml(amount)}</strong> was sent for your ${escapeHtml(groupName)} payout.`)}
       ${detailRows([
         ['Group', groupName],
         ['Amount', amount],
         ['Reference', reference],
       ])}`,
      `${amount} was sent for your ${groupName} payout. Reference: ${reference}.`,
    );
  },
  'ajo-group-invite': (variables) => {
    const groupName = required(variables, 'groupName');
    const inviterName = required(variables, 'inviterName');
    return actionEmail(
      `${inviterName} invited you to ${groupName}`,
      'You have an Ajo group invite',
      `${inviterName} invited you to join the Ajo group ${groupName}.`,
      'View invite',
      required(variables, 'inviteUrl'),
      `Contribution: ${required(variables, 'amount')} · ${required(variables, 'frequency')}`,
      'Only join groups run by people you trust. Ajo Cloud does not guarantee contributions between members.',
    );
  },
  'food-distribution-ready': (variables) => {
    const programmeName = required(variables, 'programmeName');
    const pickupDate = required(variables, 'pickupDate');
    return email(
      'Your Food Ajo package is ready',
      'Food Ajo distribution update',
      'Your package is ready',
      `${paragraph(`Your <strong>${escapeHtml(programmeName)}</strong> package is ready for collection.`)}
       ${detailRows([
         ['Programme', programmeName],
         ['Pickup date', pickupDate],
         ['Location', required(variables, 'location')],
       ])}
       ${muted('Bring a valid ID that matches your Ajo Cloud account name.')}`,
      `Your ${programmeName} Food Ajo package is ready. Pickup: ${pickupDate} at ${required(variables, 'location')}.`,
    );
  },
  'akawo-goal-progress': (variables) => {
    const goalName = required(variables, 'goalName');
    const progress = required(variables, 'progress');
    return email(
      `Progress on ${goalName}`,
      'Akawo savings progress',
      'You are making progress',
      `${paragraph(`You have reached <strong>${escapeHtml(progress)}</strong> of your ${escapeHtml(goalName)} goal.`)}
       ${progressBar(progress)}
       ${detailRows([
         ['Saved', required(variables, 'saved')],
         ['Target', required(variables, 'target')],
       ])}`,
      `You have reached ${progress} of your ${goalName} Akawo goal (${required(variables, 'saved')} of ${required(variables, 'target')}).`,
    );
  },
  'akawo-goal-reached': (variables) => {
    const goalName = required(variables, 'goalName');
    const target = required(variables, 'target');
    return email(
      `You reached your ${goalName} goal`,
      'Akawo goal reached',
      'Goal reached',
      `${paragraph(`You saved <strong>${escapeHtml(target)}</strong> and completed your ${escapeHtml(goalName)} goal.`)}
       ${progressBar('100%')}
       ${paragraph('Open Ajo Cloud to withdraw your savings or roll them into a new goal.')}`,
      `Congratulations — you reached your ${goalName} Akawo goal of ${target}.`,
    );
  },
  'bill-payment-receipt': (variables) => {
    const serviceName = required(variables, 'serviceName');
    const amount = required(variables, 'amount');
    const reference = required(variables, 'reference');
    return email(
      `Receipt for ${serviceName}`,
      'Bill payment receipt',
      'Payment successful',
      `${paragraph(`Your payment for <strong>${escapeHtml(serviceName)}</strong> went through.`)}
       ${detailRows([
         ['Service', serviceName],
         ['Amount', amount],
         ['Reference', reference],
         ['Paid', required(variables, 'paidAt')],
       ])}`,
      `Your ${amount} payment for ${serviceName} was successful. Reference: ${reference}.`,
    );
  },
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
  preheader: string,
  heading: string,
  actionLabel: string,
  actionUrl: string,
  detail: string,
  footnote: string,
): Omit<RenderedEmailTemplate, 'key' | 'version'> {
  const safeUrl = escapeHtml(actionUrl);
  return email(
    subject,
    preheader,
    heading,
    `${paragraph(detail)}
     <table role="presentation" cellspacing="0" cellpadding="0" style="margin:28px 0">
       <tr><td style="border-radius:10px;background:${BRAND}">
         <a href="${safeUrl}" style="display:inline-block;padding:14px 28px;color:#ffffff;text-decoration:none;font-weight:600;font-size:15px;border-radius:10px">${escapeHtml(actionLabel)}</a>
       </td></tr>
     </table>
     ${muted(`If the button does not work, paste this link into your browser:<br><span style="word-break:break-all;color:${BRAND}">${safeUrl}</span>`)}
     ${securityNote(footnote)}`,
    `${heading} ${detail} ${actionLabel}: ${actionUrl}`,
  );
}

const BRAND = '#0D47A1';
const INK = '#172033';
const MUTED = '#667085';
const BORDER = '#dce3ee';

function paragraph(html: string): string {
  return `<p style="margin:0 0 16px;font-size:15px;line-height:1.6;color:${INK}">${html}</p>`;
}

function muted(html: string): string {
  return `<p style="margin:0 0 16px;font-size:13px;line-height:1.6;color:${MUTED}">${html}</p>`;
}

function codeBlock(code: string): string {
  return `<div style="margin:24px 0;padding:20px;background:#f4f7fb;border:1px solid ${BORDER};border-radius:12px;text-align:center">
    <div style="font-size:34px;font-weight:700;letter-spacing:10px;color:${BRAND};font-family:'Courier New',monospace">${escapeHtml(code)}</div>
  </div>`;
}

function bullets(items: readonly string[]): string {
  const rows = items
    .map(
      (item) =>
        `<li style="margin:0 0 8px;font-size:15px;line-height:1.6;color:${INK}">${item}</li>`,
    )
    .join('');
  return `<ul style="margin:0 0 16px;padding-left:20px">${rows}</ul>`;
}

/** Label/value rows for receipts and security notices. */
function detailRows(rows: readonly (readonly [string, string])[]): string {
  const cells = rows
    .map(
      ([label, value]) =>
        `<tr>
           <td style="padding:10px 0;border-bottom:1px solid ${BORDER};font-size:13px;color:${MUTED}">${escapeHtml(label)}</td>
           <td style="padding:10px 0;border-bottom:1px solid ${BORDER};font-size:14px;color:${INK};font-weight:600;text-align:right">${escapeHtml(value)}</td>
         </tr>`,
    )
    .join('');
  return `<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="margin:0 0 20px">${cells}</table>`;
}

function progressBar(progress: string): string {
  // Clamp to 0–100 so a malformed variable can never overflow the layout.
  const pct = Math.max(0, Math.min(100, Number.parseFloat(progress.replace('%', '')) || 0));
  return `<div style="margin:0 0 20px;height:10px;background:#e8eef7;border-radius:999px;overflow:hidden">
    <div style="width:${pct}%;height:10px;background:${BRAND};border-radius:999px"></div>
  </div>`;
}

function alert(text: string): string {
  return `<div style="margin:20px 0 0;padding:14px 16px;background:#fef3f2;border-left:3px solid #d92d20;border-radius:6px">
    <p style="margin:0;font-size:14px;line-height:1.6;color:#912018">${escapeHtml(text)}</p>
  </div>`;
}

function securityNote(text: string): string {
  return `<p style="margin:24px 0 0;padding-top:16px;border-top:1px solid ${BORDER};font-size:13px;line-height:1.6;color:${MUTED}">${escapeHtml(text)}</p>`;
}

function layout(preheader: string, heading: string, body: string): string {
  return `<!doctype html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(preheader)}</title></head>
<body style="margin:0;background:#f4f7fb;color:${INK};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif">
  <div style="display:none;max-height:0;overflow:hidden">${escapeHtml(preheader)}</div>
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f4f7fb;padding:24px 12px">
    <tr><td align="center">
      <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#ffffff;border:1px solid ${BORDER};border-radius:14px;overflow:hidden">
        <tr><td style="background:${BRAND};color:#ffffff;padding:22px 28px;font-size:20px;font-weight:700;letter-spacing:-0.2px">Ajo Cloud</td></tr>
        <tr><td style="padding:32px 28px">
          <h1 style="font-size:22px;line-height:1.3;margin:0 0 18px;color:${INK};font-weight:700">${heading}</h1>
          ${body}
        </td></tr>
        <tr><td style="border-top:1px solid ${BORDER};padding:20px 28px;color:${MUTED};font-size:12px;line-height:1.5">
          This is a transactional message from Ajo Cloud. Never share passwords, PINs, or verification codes.
        </td></tr>
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
