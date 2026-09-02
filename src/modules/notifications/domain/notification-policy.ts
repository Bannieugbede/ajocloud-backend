export function isWithinQuietHours(input: {
  readonly localMinuteOfDay: number;
  readonly startMinute?: number;
  readonly endMinute?: number;
}): boolean {
  if (input.startMinute === undefined || input.endMinute === undefined) return false;
  if (input.startMinute === input.endMinute) return true;
  if (input.startMinute < input.endMinute) {
    return input.localMinuteOfDay >= input.startMinute && input.localMinuteOfDay < input.endMinute;
  }
  return input.localMinuteOfDay >= input.startMinute || input.localMinuteOfDay < input.endMinute;
}

export function notificationDedupeKey(
  userId: string,
  eventType: string,
  subjectId: string,
  scheduledAtIso: string,
): string {
  return `${userId}:${eventType}:${subjectId}:${scheduledAtIso}`;
}

/** The minute of day in a named timezone, for quiet-hours comparison. */
export function localMinuteOfDay(at: Date, timezone: string): number {
  // Intl is used rather than an offset table so DST and any future Nigerian
  // offset change are handled by the platform's own tz database.
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(at);
  const hour = Number(parts.find((part) => part.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((part) => part.type === 'minute')?.value ?? '0');
  // 24:00 is a legal formatted value for midnight in some locales/engines.
  return (hour % 24) * 60 + minute;
}

export type SuppressionReason = 'DISABLED' | 'QUIET_HOURS';

export interface NotificationDecision {
  readonly send: boolean;
  readonly reason?: SuppressionReason;
}

/**
 * Whether a notification may be delivered now.
 *
 * A template with no topic is always sent: security and account-recovery mail
 * cannot be declined or delayed, because a suppressed reset email locks a user
 * out and a late login alert is not an alert.
 *
 * With no stored preference the answer is to send. Preferences are opt-out, so
 * absence means the user has not declined rather than that they have.
 */
export function decideDelivery(input: {
  readonly topic: string | null;
  readonly preference?: {
    readonly enabled: boolean;
    readonly quietHoursStartMinutes: number | null;
    readonly quietHoursEndMinutes: number | null;
    readonly timezone: string;
  } | null;
  readonly now: Date;
}): NotificationDecision {
  if (input.topic === null) return { send: true };
  const preference = input.preference;
  if (!preference) return { send: true };
  if (!preference.enabled) return { send: false, reason: 'DISABLED' };
  if (
    preference.quietHoursStartMinutes !== null &&
    preference.quietHoursEndMinutes !== null &&
    isWithinQuietHours({
      localMinuteOfDay: localMinuteOfDay(input.now, preference.timezone),
      startMinute: preference.quietHoursStartMinutes,
      endMinute: preference.quietHoursEndMinutes,
    })
  ) {
    return { send: false, reason: 'QUIET_HOURS' };
  }
  return { send: true };
}

/** Quiet hours are stored as minutes from midnight, so both ends must be a
    real time of day and either both set or both absent. */
export function isValidQuietHours(
  startMinutes: number | null | undefined,
  endMinutes: number | null | undefined,
): boolean {
  const start = startMinutes ?? null;
  const end = endMinutes ?? null;
  if (start === null && end === null) return true;
  if (start === null || end === null) return false;
  return [start, end].every((value) => Number.isInteger(value) && value >= 0 && value < 24 * 60);
}
