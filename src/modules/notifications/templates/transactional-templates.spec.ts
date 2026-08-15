import {
  EMAIL_TEMPLATE_KEYS,
  SMS_TEMPLATE_KEYS,
  renderEmailTemplate,
  renderSmsTemplate,
} from './transactional-templates.js';

const variables = {
  code: '123456',
  expiresMinutes: '10',
  firstName: '<Joshua>',
  resetUrl: 'https://example.com/reset?token=safe',
  occurredAt: '17 July 2026 at 10:00 WAT',
  device: 'iPhone',
  groupName: 'Friends Circle',
  amount: 'NGN 10,000',
  dueDate: '20 July 2026',
  reference: 'AJO-123',
  programmeName: 'Monthly Essentials',
  pickupDate: '30 July 2026',
  goalName: 'Emergency Fund',
  progress: '75%',
  serviceName: 'Electricity',
  reason: 'Document photo was unreadable',
  balance: 'NGN 25,000',
  destination: 'GTBank ****1234',
  location: 'Ikeja Distribution Centre',
  saved: 'NGN 75,000',
  target: 'NGN 100,000',
  inviterName: 'Ada',
  inviteUrl: 'https://example.com/invite?token=safe',
  frequency: 'Monthly',
  paidAt: '18 July 2026 at 09:30 WAT',
};

describe('transactional templates', () => {
  it.each(EMAIL_TEMPLATE_KEYS)('renders versioned email template %s', (key) => {
    const rendered = renderEmailTemplate(key, variables);
    expect(rendered.version).toBe(1);
    expect(rendered.subject.length).toBeGreaterThan(3);
    expect(rendered.html).toContain('Ajo Cloud');
    expect(rendered.text.length).toBeGreaterThan(20);
  });

  it.each(SMS_TEMPLATE_KEYS)('renders versioned SMS template %s', (key) => {
    const rendered = renderSmsTemplate(key, variables);
    expect(rendered.version).toBe(1);
    expect(rendered.content).toContain('Ajo Cloud');
  });

  it('escapes user-controlled HTML variables', () => {
    const rendered = renderEmailTemplate('welcome', variables);
    expect(rendered.html).toContain('&lt;Joshua&gt;');
    expect(rendered.html).not.toContain('<Joshua>');
  });

  it('escapes user-controlled values rendered into detail rows', () => {
    const rendered = renderEmailTemplate('kyc-rejected', {
      ...variables,
      reason: '<img src=x onerror=alert(1)>',
    });
    expect(rendered.html).not.toContain('<img src=x');
    expect(rendered.html).toContain('&lt;img src=x');
  });

  it('clamps a malformed progress value instead of overflowing the bar', () => {
    const rendered = renderEmailTemplate('akawo-goal-progress', {
      ...variables,
      progress: '900%',
    });
    expect(rendered.html).toContain('width:100%');
  });

  it('rejects missing required variables', () => {
    expect(() => renderEmailTemplate('welcome', {})).toThrow('Missing template variable');
  });
});
