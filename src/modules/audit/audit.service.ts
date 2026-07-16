import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from '../../infrastructure/database/prisma.service.js';

export interface AuditEvent {
  readonly actorUserId?: string;
  readonly action: string;
  readonly subjectType: string;
  readonly subjectId?: string;
  readonly organisationId?: string;
  readonly groupId?: string;
  readonly requestId?: string;
  readonly ipAddress?: string;
  readonly metadata?: Record<string, unknown>;
}

const SENSITIVE_KEYS =
  /password|token|secret|otp|bvn|nin|card|authorization|customerReference|accountNumber|biometric|mediaReference/i;

@Injectable()
export class AuditService {
  constructor(private readonly prisma: PrismaService) {}

  async record(event: AuditEvent): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        action: event.action,
        subjectType: event.subjectType,
        ...(event.actorUserId ? { actorUserId: event.actorUserId } : {}),
        ...(event.subjectId ? { subjectId: event.subjectId } : {}),
        ...(event.organisationId ? { organisationId: event.organisationId } : {}),
        ...(event.groupId ? { groupId: event.groupId } : {}),
        ...(event.requestId ? { requestId: event.requestId } : {}),
        ...(event.ipAddress ? { ipAddress: event.ipAddress } : {}),
        ...(event.metadata ? { metadata: this.redact(event.metadata) } : {}),
      },
    });
  }

  private redact(value: Record<string, unknown>): Prisma.InputJsonObject {
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [
        key,
        SENSITIVE_KEYS.test(key) ? '[REDACTED]' : this.toJson(nested),
      ]),
    );
  }

  private toJson(value: unknown): Prisma.InputJsonValue {
    if (value === null) return 'null';
    if (typeof value === 'string' || typeof value === 'boolean') return value;
    if (typeof value === 'number' && Number.isFinite(value)) return value;
    if (typeof value === 'bigint') return value.toString();
    if (value instanceof Date) return value.toISOString();
    if (Array.isArray(value)) return value.map((item) => this.toJson(item));
    if (value && typeof value === 'object') return this.redact(value as Record<string, unknown>);
    return '[UNSERIALIZABLE]';
  }
}
