import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { FastifyRequest } from 'fastify';
import type { Environment } from '../../../config/env.schema.js';
import { MONNIFY_SIGNATURE_HEADER, verifyMonnifySignature } from '../domain/monnify-signature.js';

/**
 * Rejects any Monnify webhook whose HMAC-SHA512 signature does not verify
 * against the raw request body (ADR-006).
 *
 * This guard is the entire security boundary for these routes: they are public,
 * unauthenticated, and instruct movements of money. Nothing downstream may
 * treat a payload as trustworthy unless it passed here.
 *
 * There is no development bypass. A flag that skips verification is one
 * misconfigured deploy away from accepting forged instructions in production,
 * and the value of that convenience does not come close to the cost.
 */
@Injectable()
export class MonnifySignatureGuard implements CanActivate {
  private readonly logger = new Logger(MonnifySignatureGuard.name);

  constructor(private readonly config: ConfigService<Environment, true>) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<FastifyRequest>();

    if (!this.config.get('MONNIFY_WEBHOOKS_ENABLED', { infer: true })) {
      throw new ServiceUnavailableException('Webhook endpoint is not enabled');
    }

    const secret = this.config.get('MONNIFY_WEBHOOK_SECRET', { infer: true });
    if (!secret) {
      // Unreachable when the env schema is respected; kept because failing
      // closed on a configuration gap must not depend on validation elsewhere.
      this.logger.error('Monnify webhook secret is not configured; rejecting delivery');
      throw new ServiceUnavailableException('Webhook endpoint is not enabled');
    }

    const rawBody = request.rawBody;
    if (!rawBody) {
      // Means the raw-body parser did not run for this route. Verifying against
      // anything else would not be verifying what Monnify signed.
      this.logger.error('Raw body unavailable for a Monnify webhook; rejecting delivery');
      throw new UnauthorizedException('Invalid webhook signature');
    }

    const header = request.headers[MONNIFY_SIGNATURE_HEADER];
    const supplied = Array.isArray(header) ? header[0] : header;

    if (!verifyMonnifySignature(rawBody, supplied, secret)) {
      // Log the fact and the route, never the payload or the signature: the
      // body of an unverified request is attacker-controlled content.
      this.logger.warn(`Rejected Monnify webhook with invalid signature on ${request.url}`);
      throw new UnauthorizedException('Invalid webhook signature');
    }

    return true;
  }
}
