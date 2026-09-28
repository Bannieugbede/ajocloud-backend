import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Renders every uncaught exception as the API's error envelope.
 *
 * Server faults are logged with their stack and correlated to the response by
 * `requestId`; without that, a 500 reaching a client leaves nothing behind to
 * investigate with, and the id handed to the caller points at no record. Client
 * errors (4xx) are not logged: they are the caller's mistake, they are already
 * described in the response, and logging them lets anyone fill the logs by
 * sending bad requests.
 *
 * The response body itself never carries the underlying message for a 5xx. An
 * exception's text routinely contains connection strings, query fragments, or
 * provider payloads, and the caller can do nothing with it regardless.
 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const response = exception instanceof HttpException ? exception.getResponse() : undefined;
    const message = this.messageFor(response, status);

    if (status >= 500) {
      this.logServerFault(exception, request, status);
    }

    const details = status < 500 ? this.detailsFor(response) : undefined;
    void reply.status(status).send({
      error: {
        code: this.codeFor(status, response),
        message,
        ...(details ? { details } : {}),
        requestId: request.id,
        timestamp: new Date().toISOString(),
      },
    });
  }

  /**
   * Logs the method and route rather than the full URL: a path can carry a
   * token or an identifier in its query string, and the route is what identifies
   * the failing handler anyway.
   */
  private logServerFault(exception: unknown, request: FastifyRequest, status: number): void {
    const route = request.url.split('?')[0] ?? request.url;
    const context = `${status} ${request.method} ${route} requestId=${String(request.id)}`;
    if (exception instanceof Error) {
      this.logger.error(`${context}: ${exception.name}: ${exception.message}`, exception.stack);
      return;
    }
    // A thrown non-Error has no stack to report; record its shape so the cause
    // is still traceable.
    this.logger.error(`${context}: non-error thrown: ${this.describe(exception)}`);
  }

  private describe(value: unknown): string {
    if (typeof value === 'string') return value;
    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      // Circular or otherwise unserialisable: the type is still a useful clue.
      return Object.prototype.toString.call(value);
    }
  }

  private messageFor(response: string | object | undefined, status: number): string | string[] {
    if (typeof response === 'string') return response;
    if (response && 'message' in response) {
      const message = (response as { message?: unknown }).message;
      if (
        typeof message === 'string' ||
        (Array.isArray(message) && message.every((v) => typeof v === 'string'))
      ) {
        return message;
      }
    }
    return status >= 500 ? 'An internal error occurred' : 'The request could not be completed';
  }

  /**
   * A client error may name its own code, e.g. `KYC_STAGE_REQUIRED`, so an app
   * can act on the refusal rather than parse its wording. Only an upper-case
   * identifier is passed through, and never on a 5xx.
   */
  private codeFor(status: number, response?: string | object): string {
    if (status < 500 && response && typeof response === 'object' && 'code' in response) {
      const code = (response as { code?: unknown }).code;
      if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{2,63}$/.test(code)) return code;
    }
    return `HTTP_${status}`;
  }

  /** Structured context a client error chose to expose, e.g. the stage it needs. */
  private detailsFor(response: string | object | undefined): Record<string, unknown> | undefined {
    if (!response || typeof response !== 'object' || !('details' in response)) return undefined;
    const details = (response as { details?: unknown }).details;
    return details && typeof details === 'object' && !Array.isArray(details)
      ? (details as Record<string, unknown>)
      : undefined;
  }
}
