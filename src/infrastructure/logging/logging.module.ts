import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { LoggerModule } from 'nestjs-pino';
import type { Environment } from '../../config/env.schema.js';

export function developmentLogTransport(nodeEnvironment: Environment['NODE_ENV']) {
  return nodeEnvironment === 'development'
    ? {
        target: 'pino-pretty' as const,
        options: {
          colorize: true,
          ignore: 'pid,hostname',
          singleLine: true,
          translateTime: 'SYS:standard',
        },
      }
    : undefined;
}

@Module({
  imports: [
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) => {
        const transport = developmentLogTransport(config.get('NODE_ENV', { infer: true }));
        return {
          pinoHttp: {
            level: config.get('LOG_LEVEL', { infer: true }),
            ...(transport ? { transport } : {}),
            genReqId: (request, response) => {
              const incoming = request.headers['x-request-id'];
              const requestId =
                typeof incoming === 'string' ? incoming.slice(0, 128) : randomUUID();
              response.setHeader('x-request-id', requestId);
              return requestId;
            },
            redact: {
              paths: [
                'req.headers.authorization',
                'req.headers.cookie',
                'req.body.password',
                'req.body.refreshToken',
                'req.body.otp',
                'req.body.customerReference',
                'req.body.bvn',
                'req.body.nin',
                'req.body.ninOrVnin',
                'req.body.accountNumber',
                'req.body.encryptedMediaReference',
                '*.passwordHash',
                '*.tokenHash',
              ],
              censor: '[REDACTED]',
            },
          },
        };
      },
    }),
  ],
  exports: [LoggerModule],
})
export class LoggingModule {}
