import { Injectable, Logger } from '@nestjs/common';
import type { PushDeliveryResult, PushProvider, SendPushInput } from './push-provider.js';

/**
 * Development push provider. Logs that a notification would have been sent and
 * accepts every token, so local flows work without reaching Expo's servers.
 *
 * The title and body are logged; the data payload is not, because it can carry
 * identifiers that do not belong in logs.
 */
@Injectable()
export class ConsolePushProvider implements PushProvider {
  readonly name = 'console';
  private readonly logger = new Logger(ConsolePushProvider.name);

  send(input: SendPushInput): Promise<PushDeliveryResult> {
    this.logger.log(`Push to ${String(input.to.length)} device(s): ${input.title}`);
    return Promise.resolve({
      provider: this.name,
      results: input.to.map((token) => ({ token, accepted: true, unregistered: false })),
    });
  }
}
