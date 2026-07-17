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

  it('rejects missing required variables', () => {
    expect(() => renderEmailTemplate('welcome', {})).toThrow('Missing template variable');
  });
});
