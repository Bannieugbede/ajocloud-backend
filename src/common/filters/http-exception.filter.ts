import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const status =
      exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const response = exception instanceof HttpException ? exception.getResponse() : undefined;
    const message = this.messageFor(response, status);

    void reply.status(status).send({
      error: {
        code: this.codeFor(status),
        message,
        requestId: request.id,
        timestamp: new Date().toISOString(),
      },
    });
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
