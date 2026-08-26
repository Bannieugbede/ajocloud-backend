import { SetMetadata } from '@nestjs/common';

export const PUBLIC_ENDPOINT_KEY = 'publicEndpoint';

/**
 * Marks a route as unauthenticated and open to any origin, which exempts it
 * from the double-submit CSRF check.
 *
 * The check keys off the presence of a session cookie, so a public form posted
 * by a visitor who happens to be signed in elsewhere on the domain would
 * otherwise be rejected — the cookie rides along on a request that never
 * consults it. Only use this on endpoints that read no ambient credential and
 * whose effect is safe for an anonymous caller to trigger.
 */
export const PublicEndpoint = (): MethodDecorator & ClassDecorator =>
  SetMetadata(PUBLIC_ENDPOINT_KEY, true);
