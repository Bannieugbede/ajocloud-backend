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

    void reply.status(status).send({
      error: {
        code: this.codeFor(status),
        message,
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

  private codeFor(status: number): string {
    return `HTTP_${status}`;
  }
}
