import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../../config/env.schema.js';

const DEFAULT_BASE_URL = 'https://api.resend.com';
const REQUEST_TIMEOUT_MS = 15_000;

export interface ResendEmailRequest {
  readonly from: string;
  readonly to: readonly string[];
  readonly subject: string;
  readonly html?: string;
  readonly text?: string;
  readonly tags?: readonly { readonly name: string; readonly value: string }[];
  readonly idempotencyKey: string;
}

export interface ResendEmailResponse {
  readonly id: string;
}

/**
 * Thin transport around the Resend REST API. Resend ships an official SDK, but a
 * single POST /emails call does not justify the dependency, and `fetch` keeps the
 * runtime image free of another transitive tree.
 */
@Injectable()
export class ResendClientService {
  private readonly apiKey: string | undefined;
  private readonly baseUrl: string;

  constructor(config: ConfigService<Environment, true>) {
    this.apiKey = config.get('RESEND_API_KEY', { infer: true }) || undefined;
    this.baseUrl = (config.get('RESEND_BASE_URL', { infer: true }) || DEFAULT_BASE_URL).replace(
      /\/$/,
      '',
    );
  }

  async sendEmail(input: ResendEmailRequest): Promise<ResendEmailResponse> {
    if (!this.apiKey) throw new ServiceUnavailableException('Resend is not configured');
    const { idempotencyKey, ...payload } = input;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
          // Resend deduplicates retries of the same key for 24 hours.
          'Idempotency-Key': idempotencyKey,
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      // Never surface the raw transport error: it can carry the request payload.
      throw new ServiceUnavailableException('Resend request failed');
    }

    if (!response.ok) {
      throw new ServiceUnavailableException(`Resend rejected the request (${response.status})`);
    }

    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    if (!body?.id) {
      throw new ServiceUnavailableException('Resend did not return a message ID');
    }
    return { id: body.id };
  }
}
