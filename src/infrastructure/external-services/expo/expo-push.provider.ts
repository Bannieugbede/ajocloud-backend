import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../config/env.schema.js';
import type {
  PushDeliveryResult,
  PushProvider,
  PushTokenResult,
  SendPushInput,
} from '../../../modules/notifications/providers/push-provider.js';

const DEFAULT_BASE_URL = 'https://exp.host';
const REQUEST_TIMEOUT_MS = 15_000;
/** Expo accepts at most 100 messages per request. */
const MAX_BATCH = 100;

interface ExpoTicket {
  readonly status?: string;
  readonly id?: string;
  readonly message?: string;
  readonly details?: { readonly error?: string };
}

/**
 * Sends through Expo's push service.
 *
 * Expo answers with one ticket per token, so a batch is not all-or-nothing: a
 * single dead token must not stop everyone else's notification. Tickets are
 * mapped back to their token by position, which is the only correlation the API
 * offers.
 *
 * Delivery receipts are deliberately not polled here. Expo advises checking
 * them about fifteen minutes after sending, which belongs to a worker rather
 * than to a request that a user is waiting on.
 */
@Injectable()
export class ExpoPushProvider implements PushProvider {
  readonly name = 'expo';
  private readonly logger = new Logger(ExpoPushProvider.name);
  private readonly baseUrl: string;
  private readonly accessToken: string | undefined;

  constructor(config: ConfigService<Environment, true>) {
    this.baseUrl = (config.get('EXPO_PUSH_BASE_URL', { infer: true }) || DEFAULT_BASE_URL).replace(
      /\/$/,
      '',
    );
    // Optional: only needed when the Expo project enables enhanced security.
    this.accessToken = config.get('EXPO_ACCESS_TOKEN', { infer: true }) || undefined;
  }

  async send(input: SendPushInput): Promise<PushDeliveryResult> {
    const results: PushTokenResult[] = [];
    for (let index = 0; index < input.to.length; index += MAX_BATCH) {
      const batch = input.to.slice(index, index + MAX_BATCH);
      results.push(...(await this.sendBatch(batch, input)));
    }
    return { provider: this.name, results };
  }

  private async sendBatch(
    tokens: readonly string[],
    input: SendPushInput,
  ): Promise<PushTokenResult[]> {
    const messages = tokens.map((token) => ({
      to: token,
      title: input.title,
      body: input.body,
      ...(input.data ? { data: input.data } : {}),
    }));

    let tickets: ExpoTicket[];
    try {
      const response = await fetch(`${this.baseUrl}/--/api/v2/push/send`, {
        method: 'POST',
        headers: {
          accept: 'application/json',
          'content-type': 'application/json',
          ...(this.accessToken ? { authorization: `Bearer ${this.accessToken}` } : {}),
        },
        body: JSON.stringify(messages),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      if (!response.ok) {
        // The transport failed rather than individual tokens, so nothing here
        // is treated as unregistered: these are worth retrying.
        this.logger.warn(`Expo push rejected the batch with status ${String(response.status)}`);
        return tokens.map((token) => ({
          token,
          accepted: false,
          unregistered: false,
          failureReason: 'PUSH_TRANSPORT_FAILED',
        }));
      }
      const payload = (await response.json()) as { data?: ExpoTicket[] };
      tickets = payload.data ?? [];
    } catch {
      // Never surfaces the provider's raw error: it can carry request detail
      // that does not belong in our logs.
      this.logger.warn('Expo push request failed');
      return tokens.map((token) => ({
        token,
        accepted: false,
        unregistered: false,
        failureReason: 'PUSH_TRANSPORT_FAILED',
      }));
    }

    return tokens.map((token, position) => {
      const ticket = tickets[position];
      if (!ticket) {
        return {
          token,
          accepted: false,
          unregistered: false,
          failureReason: 'PUSH_NO_TICKET',
        };
      }
      if (ticket.status === 'ok') {
        return {
          token,
          accepted: true,
          unregistered: false,
          ...(ticket.id ? { ticketId: ticket.id } : {}),
        };
      }
      // The one error that means the token is permanently dead. Anything else
      // may be transient, so the token is kept.
      const unregistered = ticket.details?.error === 'DeviceNotRegistered';
      return {
        token,
        accepted: false,
        unregistered,
        failureReason: unregistered ? 'DEVICE_NOT_REGISTERED' : 'PUSH_REJECTED',
      };
    });
  }
}
