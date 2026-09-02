import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  NOTIFICATION_TOPICS,
  isAlwaysSent,
  isNotificationTopic,
  topicForTemplate,
} from './notification-topics.js';

describe('notification topics', () => {
  it('recognises only catalogued topics', () => {
    expect(isNotificationTopic('ajo.payout')).toBe(true);
    expect(isNotificationTopic('ajo.payouts')).toBe(false);
    expect(isNotificationTopic('')).toBe(false);
  });

  it('reports security templates as always sent', () => {
    for (const template of [
      'password-reset',
      'password-reset-sms',
      'new-login-alert',
      'account-locked',
      'staff-invite',
    ]) {
      expect(isAlwaysSent(template)).toBe(true);
      expect(topicForTemplate(template)).toBeNull();
    }
  });

  it('never offers a topic for something the user cannot decline', () => {
    // A switch that does nothing is worse than no switch, so no always-sent
    // template may map to a catalogued topic.
    for (const topic of NOTIFICATION_TOPICS) {
      expect(isAlwaysSent(topic)).toBe(false);
    }
  });

  it('maps product templates to their topic', () => {
    expect(topicForTemplate('ajo-payout-sent')).toBe('ajo.payout');
    expect(topicForTemplate('bill-payment-receipt')).toBe('bills.receipt');
    expect(topicForTemplate('akawo-goal-reached')).toBe('akawo.progress');
  });

  it('refuses an unclassified template rather than guessing', () => {
    expect(() => topicForTemplate('some-new-template')).toThrow(/not mapped/);
  });

  /**
   * Reads the template union from source. A template added without a topic
   * would otherwise only fail when it was first sent, in production.
   */
  it('classifies every template the catalog defines', () => {
    const source = readFileSync(join(__dirname, '../templates/transactional-templates.ts'), 'utf8');
    const declared = [...source.matchAll(/^\s*\|?\s*'([a-z0-9-]+)'/gm)].map((match) => match[1]);
    const keys = declared.filter((key): key is string => Boolean(key));
    expect(keys.length).toBeGreaterThan(15);
    for (const key of keys) {
      expect(() => topicForTemplate(key)).not.toThrow();
    }
  });
});
