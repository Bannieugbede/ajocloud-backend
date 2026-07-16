import { ConflictException, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env.schema.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

@Injectable()
export class IdempotencyService {
  private readonly ttlSeconds: number;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService<Environment, true>,
  ) {
    this.ttlSeconds = config.get('IDEMPOTENCY_TTL_SECONDS', { infer: true });
  }

  hashRequest(body: unknown): string {
    return createHash('sha256').update(JSON.stringify(body)).digest('hex');
  }

  async claim(scope: string, key: string, requestHash: string): Promise<string> {
    const existing = await this.prisma.idempotencyRecord.findUnique({
      where: { scope_key: { scope, key } },
    });
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ConflictException('Idempotency key was already used for another request');
      }
      throw new ConflictException('Request with this idempotency key is already recorded');
    }
    const expiresAt = new Date(Date.now() + this.ttlSeconds * 1_000);
    const record = await this.prisma.idempotencyRecord.create({
      data: { scope, key, requestHash, expiresAt },
    });
    return record.id;
  }
}
