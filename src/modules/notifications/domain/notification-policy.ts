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
