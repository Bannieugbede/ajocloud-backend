export function maskIdentityValue(value: string): string {
  const normalized = value.replace(/\s/g, '');
  if (normalized.length <= 4) return '*'.repeat(normalized.length);
  return `${'*'.repeat(normalized.length - 4)}${normalized.slice(-4)}`;
}

export function safeVerificationResponse(input: {
  readonly providerReference?: string;
  readonly maskedIdentifier?: string;
  readonly status: string;
  readonly resultCode?: string;
}): Record<string, string> {
  return Object.fromEntries(
    Object.entries(input).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    ),
  );
}
