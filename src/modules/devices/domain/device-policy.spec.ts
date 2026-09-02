import { UnprocessableEntityException } from '@nestjs/common';
import {
  REASK_PERMISSION_AFTER_MS,
  assertFingerprint,
  assertPushToken,
  describeDevice,
  isExpoPushToken,
  shouldRequestPushPermission,
} from './device-policy.js';

describe('push tokens', () => {
  it('accepts both shapes Expo issues', () => {
    expect(isExpoPushToken('ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]')).toBe(true);
    expect(isExpoPushToken('ExpoPushToken[abc-DEF_123]')).toBe(true);
  });

  it('refuses anything that would never deliver', () => {
    // A malformed value stored as a token looks deliverable and fails silently
    // at every send instead.
    for (const value of ['', 'not-a-token', 'ExponentPushToken[]', 'ExponentPushToken[abc']) {
      expect(isExpoPushToken(value)).toBe(false);
      expect(() => assertPushToken(value)).toThrow(UnprocessableEntityException);
    }
  });
});

describe('fingerprints', () => {
  it('requires enough length to be an identifier rather than a guess', () => {
    expect(() => assertFingerprint('short')).toThrow(UnprocessableEntityException);
    expect(() => assertFingerprint('a'.repeat(16))).not.toThrow();
  });

  it('refuses one longer than the column', () => {
    expect(() => assertFingerprint('a'.repeat(192))).toThrow(UnprocessableEntityException);
  });
});

describe('shouldRequestPushPermission', () => {
  const now = new Date('2026-09-03T12:00:00.000Z');

  it('does not ask when a token is already held', () => {
    expect(shouldRequestPushPermission({ hasToken: true, declinedAt: null, now })).toBe(false);
  });

  it('asks a user who has never been asked', () => {
    expect(shouldRequestPushPermission({ hasToken: false, declinedAt: null, now })).toBe(true);
  });

  it('does not ask again straight after a decline', () => {
    // Asking on every login is how people learn to dismiss prompts unread.
    const declinedAt = new Date(now.getTime() - 1_000);
    expect(shouldRequestPushPermission({ hasToken: false, declinedAt, now })).toBe(false);
  });

  it('asks again after a long gap', () => {
    const declinedAt = new Date(now.getTime() - REASK_PERMISSION_AFTER_MS - 1);
    expect(shouldRequestPushPermission({ hasToken: false, declinedAt, now })).toBe(true);
  });

  it('still declines to ask when a declined user already has a token', () => {
    const declinedAt = new Date(now.getTime() - REASK_PERMISSION_AFTER_MS - 1);
    expect(shouldRequestPushPermission({ hasToken: true, declinedAt, now })).toBe(false);
  });
});

describe('describeDevice', () => {
  it('prefers the name the device reports', () => {
    expect(describeDevice({ name: "Ada's iPhone", platform: 'ios' })).toBe("Ada's iPhone");
  });

  it('falls back to the platform, then to something honest', () => {
    expect(describeDevice({ name: '  ', platform: 'android' })).toBe('android device');
    expect(describeDevice({})).toBe('Unknown device');
  });
});
