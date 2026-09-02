import { UnprocessableEntityException } from '@nestjs/common';

/**
 * Expo issues tokens in one of two shapes. Validated before storage so a
 * malformed value cannot sit in the table looking like a deliverable address
 * and silently failing at every send.
 */
const EXPO_TOKEN = /^(ExponentPushToken|ExpoPushToken)\[[A-Za-z0-9_-]+\]$/;

export function isExpoPushToken(value: string): boolean {
  return EXPO_TOKEN.test(value);
}

export function assertPushToken(value: string): void {
  if (!isExpoPushToken(value)) {
    throw new UnprocessableEntityException('That push token is not a valid Expo token');
  }
}

/**
 * A device is identified by a fingerprint the app generates once and keeps.
 *
 * Deliberately not derived from hardware identifiers: those are restricted on
 * both platforms, change across reinstalls anyway, and would make the record
 * more identifying than it needs to be. An opaque per-installation value is
 * enough to recognise the same installation again.
 */
export function isPlausibleFingerprint(value: string): boolean {
  return value.trim().length >= 16 && value.trim().length <= 191;
}

export function assertFingerprint(value: string): void {
  if (!isPlausibleFingerprint(value)) {
    throw new UnprocessableEntityException('That device identifier is not valid');
  }
}

/**
 * Whether the app should ask for notification permission again.
 *
 * A user who declined is not asked on every login — that is how people learn to
 * dismiss prompts without reading them. Asking again after a long gap is
 * reasonable, because circumstances change and the system prompt can only be
 * shown once anyway; after that the app must send them to settings.
 */
export const REASK_PERMISSION_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

export function shouldRequestPushPermission(input: {
  readonly hasToken: boolean;
  readonly declinedAt: Date | null;
  readonly now: Date;
}): boolean {
  if (input.hasToken) return false;
  if (!input.declinedAt) return true;
  return input.now.getTime() - input.declinedAt.getTime() >= REASK_PERMISSION_AFTER_MS;
}

/** A token belongs to one installation. The same token arriving for a second
    device means the app moved or was restored, so the old row must release it
    rather than both claiming to be deliverable. */
export function describeDevice(input: {
  readonly name?: string | null;
  readonly platform?: string | null;
}): string {
  const name = input.name?.trim();
  if (name) return name;
  const platform = input.platform?.trim();
  return platform ? `${platform} device` : 'Unknown device';
}
