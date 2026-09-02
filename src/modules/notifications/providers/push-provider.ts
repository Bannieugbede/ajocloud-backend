export interface SendPushInput {
  /** Expo push tokens, e.g. `ExponentPushToken[...]`. One user may hold
      several, because a person can install the app on several devices. */
  readonly to: readonly string[];
  readonly title: string;
  readonly body: string;
  /** Small payload delivered with the notification. Never sensitive: push
      payloads pass through Apple's and Google's infrastructure and are visible
      on a lock screen. */
  readonly data?: Readonly<Record<string, string>>;
  readonly idempotencyKey: string;
}

/** Per-token outcome, so one dead token does not fail a whole batch. */
export interface PushTokenResult {
  readonly token: string;
  readonly accepted: boolean;
  /** Set when the provider says this token can no longer receive anything, so
      the caller can stop sending to it. */
  readonly unregistered: boolean;
  readonly ticketId?: string;
  readonly failureReason?: string;
}

export interface PushDeliveryResult {
  readonly provider: string;
  readonly results: readonly PushTokenResult[];
}

export interface PushProvider {
  readonly name: string;
  send(input: SendPushInput): Promise<PushDeliveryResult>;
}

export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');
