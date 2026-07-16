import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env.schema.js';
import { RedisService } from '../../infrastructure/cache/redis.service.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import { RabbitMqService } from '../../infrastructure/messaging/rabbitmq.service.js';

@Injectable()
export class HealthService {
  private readonly metadata: { service: string; version: string; environment: string };

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
    private readonly rabbit: RabbitMqService,
    config: ConfigService<Environment, true>,
  ) {
    this.metadata = {
      service: config.get('APP_NAME', { infer: true }),
      version: config.get('APP_VERSION', { infer: true }),
      environment: config.get('NODE_ENV', { infer: true }),
    };
  }

  live(): Record<string, unknown> {
    return { status: 'ok', ...this.metadata, timestamp: new Date().toISOString() };
  }

  async ready(): Promise<Record<string, unknown>> {
    const checks = await Promise.all([
      this.check('postgres', async () => {
        await this.prisma.$queryRaw`SELECT 1`;
      }),
      this.check('redis', async () => {
        if (!(await this.redis.ping())) throw new Error('ping failed');
      }),
      this.check('rabbitmq', async () => {
        if (!(await this.rabbit.ping())) throw new Error('ping failed');
      }),
    ]);
    if (checks.some((check) => check.status !== 'up')) {
      throw new ServiceUnavailableException({ status: 'unavailable', checks, ...this.metadata });
    }
    return { status: 'ready', checks, ...this.metadata, timestamp: new Date().toISOString() };
  }

  private async check(
    name: string,
    operation: () => Promise<void>,
  ): Promise<{ name: string; status: 'up' | 'down' }> {
    try {
      await Promise.race([
        operation(),
        new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 2_000)),
      ]);
      return { name, status: 'up' };
    } catch {
      return { name, status: 'down' };
    }
  }
}
