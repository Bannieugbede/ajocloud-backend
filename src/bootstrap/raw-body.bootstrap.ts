import type { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
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
 *
 * Registration goes through the adapter's `useBodyParser` rather than Fastify's
 * `addContentTypeParser` directly. Nest registers its own `application/json`
 * parser while the application initialises, and Fastify permits exactly one per
 * content type; adding ours behind its back made the process die at boot with
 * `FST_ERR_CTP_ALREADY_PRESENT`. `useBodyParser` marks the parser as registered
 * so Nest installs no second one.
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
  // `getHttpAdapter()` is declared as the generic `HttpServer`, on which the
  // Fastify-specific members are optional; this application always runs on the
  // Fastify adapter.
  const adapter = app.getHttpAdapter() as FastifyAdapter;
  const instance = adapter.getInstance();
  const { bodyLimit, onProtoPoisoning, onConstructorPoisoning } = instance.initialConfig;

  // Fastify's own parser, not `JSON.parse`: it rejects `__proto__` and
  // `constructor` payloads, which a bare parse would happily accept. The
  // property is optional on the type, so a missing one is a hard failure at
  // boot rather than a silent downgrade to an unsafe parse.
  if (typeof instance.getDefaultJsonParser !== 'function') {
    throw new TypeError('Fastify instance exposes no default JSON parser');
  }
  // `FastifyBodyParser` is a union of a callback form returning `void` and a
  // promise form returning `Promise<any>`. Passing a `done` callback selects the
  // callback form, but the union hides that from the compiler, which then reads
  // the result as a possibly-floating promise. Narrowing to the overload that is
  // actually invoked keeps the call honestly typed instead of silencing it.
  const parseJson = instance.getDefaultJsonParser(
    onProtoPoisoning ?? 'error',
    onConstructorPoisoning ?? 'error',
  ) as (
    request: FastifyRequest,
    body: string,
    done: (error: Error | null, result?: unknown) => void,
  ) => void;

  // `rawBody: false` — Nest would attach `req.rawBody` on every route; the
  // callback below attaches it only for webhook routes.
  adapter.useBodyParser(
    'application/json',
    false,
    // Inherit the adapter's configured limit; omit the key entirely when unset
    // so Fastify applies its own default rather than receiving `undefined`.
    bodyLimit === undefined ? {} : { bodyLimit },
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

      // The default parser is typed for a string body; Nest's own JSON parser
      // decodes the buffer the same way before delegating.
      parseJson(request, body.toString('utf8'), (error: Error | null, parsed?: unknown) => {
        if (!error) {
          done(null, parsed);
          return;
        }
        // Never echo the body in the error: it may carry provider data, and the
        // sender already knows what it sent.
        //
        // The status code must be set explicitly. Fastify treats an error from
        // a content-type parser as a 500 unless told otherwise, and malformed
        // input from a caller is a client error — reporting it as a server
        // fault would page an on-call engineer for someone else's bad request.
        done(Object.assign(new SyntaxError('Request body is not valid JSON'), { statusCode: 400 }));
      });
    },
  );
}
