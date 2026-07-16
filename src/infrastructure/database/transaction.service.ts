import { Injectable } from '@nestjs/common';
import { Prisma } from '../../../generated/prisma/client.js';
import { PrismaService } from './prisma.service.js';

export type TransactionClient = Prisma.TransactionClient;

@Injectable()
export class TransactionService {
  constructor(private readonly prisma: PrismaService) {}

  run<T>(
    operation: (transaction: TransactionClient) => Promise<T>,
    isolationLevel: Prisma.TransactionIsolationLevel = Prisma.TransactionIsolationLevel
      .ReadCommitted,
  ): Promise<T> {
    return this.prisma.$transaction(operation, {
      isolationLevel,
      maxWait: 5_000,
      timeout: 10_000,
    });
  }

  serializable<T>(operation: (transaction: TransactionClient) => Promise<T>): Promise<T> {
    return this.run(operation, Prisma.TransactionIsolationLevel.Serializable);
  }
}
