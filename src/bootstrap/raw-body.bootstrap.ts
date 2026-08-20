import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { FastifyRequest } from 'fastify';

/**
 * Captures the unparsed request body for webhook routes.
 *
 * Provider signatures are computed over the exact bytes sent. Re-serializing a
 * parsed object produces different bytes — key order, whitespace, and number
 * formatting all differ — so verifying against `JSON.stringify(request.body)`
 * would reject valid deliveries and invite someone to "fix" it by weakening the
 * check. The raw buffer is the only correct input.
 *
 * Scope is deliberately narrow: only requests whose URL sits under the webhook
 * prefix retain a buffer, so no other route pays the memory cost and no ordinary
 * request body is held twice.
 */
export const RAW_BODY_ROUTE_SEGMENT = '/webhooks/';

declare module 'fastify' {
  interface FastifyRequest {
    /** Present only for webhook routes; see `configureRawBody`. */
    rawBody?: Buffer;
  }
}

export function isRawBodyRoute(url: string): boolean {
  // Ignore the query string so a crafted `?x=/webhooks/` cannot widen scope.
  const path = url.split('?')[0] ?? '';
  return path.includes(RAW_BODY_ROUTE_SEGMENT);
}

export function configureRawBody(app: NestFastifyApplication): void {
  const instance = app.getHttpAdapter().getInstance();

  instance.addContentTypeParser(
    'application/json',
    { parseAs: 'buffer' },
    (
      request: FastifyRequest,
      body: Buffer,
      done: (error: Error | null, result?: unknown) => void,
    ) => {
      if (isRawBodyRoute(request.url)) request.rawBody = body;

      // An empty body is valid for some providers' health pings; parsing ''
      // would throw where `null` is the honest representation.
      if (body.length === 0) {
        done(null, null);
        return;
      }
      try {
        done(null, JSON.parse(body.toString('utf8')));
      } catch {
        // Never echo the body in the error: it may carry provider data, and the
        // sender already knows what it sent.
        //
        // The status code must be set explicitly. Fastify treats an error from
        // a content-type parser as a 500 unless told otherwise, and malformed
        // input from a caller is a client error — reporting it as a server
        // fault would page an on-call engineer for someone else's bad request.
        const error = Object.assign(new SyntaxError('Request body is not valid JSON'), {
          statusCode: 400,
        });
        done(error);
      }
    },
  );
}
