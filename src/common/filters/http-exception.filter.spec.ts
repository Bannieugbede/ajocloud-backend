import { ArgumentsHost, BadRequestException, Logger } from '@nestjs/common';
import { HttpExceptionFilter } from './http-exception.filter.js';

interface SentBody {
  error: { code: string; message: string | string[]; requestId: string; timestamp: string };
}

function hostFor(url = '/api/v1/auth/login', method = 'POST') {
  const sent: { status?: number; body?: SentBody } = {};
  const reply = {
    status(code: number) {
      sent.status = code;
      return this;
    },
    send(body: SentBody) {
      sent.body = body;
    },
  };
  const request = { id: 'req-test', url, method };
  const host = {
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => reply }),
  } as unknown as ArgumentsHost;
  return { host, sent };
}

describe('HttpExceptionFilter', () => {
  let error: jest.SpiedFunction<Logger['error']>;
  beforeEach(() => {
    error = jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
  });
  afterEach(() => {
    error.mockRestore();
  });

  // Without this the only record of a production 500 is a requestId the caller
  // holds and the server cannot resolve to anything.
  it('logs a server fault with its stack so the requestId is traceable', () => {
    const { host, sent } = hostFor();
    const failure = new Error('connect ETIMEDOUT 10.0.0.1:5432');
    new HttpExceptionFilter().catch(failure, host);

    expect(sent.status).toBe(500);
    expect(error).toHaveBeenCalledTimes(1);
    const [message, stack] = error.mock.calls[0] as [string, string];
    expect(message).toContain('req-test');
    expect(message).toContain('POST /api/v1/auth/login');
    expect(message).toContain('connect ETIMEDOUT');
    expect(stack).toBe(failure.stack);
  });

  it('does not leak the underlying message to the caller', () => {
    const { host, sent } = hostFor();
    new HttpExceptionFilter().catch(new Error('password=hunter2'), host);
    expect(JSON.stringify(sent.body)).not.toContain('hunter2');
    expect(sent.body?.error.message).toBe('An internal error occurred');
  });

  // Client mistakes are already described in their own response; logging them
  // would let anyone flood the logs with malformed requests.
  it('does not log client errors', () => {
    const { host, sent } = hostFor();
    new HttpExceptionFilter().catch(new BadRequestException('email must be an email'), host);
    expect(sent.status).toBe(400);
    expect(error).not.toHaveBeenCalled();
  });

  it('logs a thrown non-error rather than discarding it', () => {
    const { host } = hostFor();
    new HttpExceptionFilter().catch({ reason: 'pool exhausted' }, host);
    expect(error).toHaveBeenCalledTimes(1);
    expect(String(error.mock.calls[0]?.[0])).toContain('pool exhausted');
  });

  // A query string can carry a token or an identifier.
  it('keeps the query string out of the log line', () => {
    const { host } = hostFor('/api/v1/auth/callback?code=secret-grant');
    new HttpExceptionFilter().catch(new Error('boom'), host);
    expect(String(error.mock.calls[0]?.[0])).not.toContain('secret-grant');
  });
});
