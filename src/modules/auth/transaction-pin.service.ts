import { BadRequestException, HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { hash, verify, argon2id } from 'argon2';

import { PrismaService } from '../../infrastructure/database/prisma.service.js';
import {
  isPinLocked,
  isValidTransactionPinShape,
  isWeakTransactionPin,
  registerFailedAttempt,
} from './domain/transaction-pin-policy.js';

export interface TransactionPinStatus {
  readonly isSet: boolean;
  readonly lockedUntil: string | null;
}

/**
 * Owns the transaction PIN used to authorise money movement. The PIN is hashed
 * with Argon2id exactly as passwords are, and neither the PIN nor its digest is
 * ever returned to a caller or written to a log.
 */
@Injectable()
export class TransactionPinService {
  constructor(private readonly prisma: PrismaService) {}

  async status(userId: string): Promise<TransactionPinStatus> {
    const pin = await this.prisma.transactionPin.findUnique({ where: { userId } });
    const lockedUntil = pin?.lockedUntil ?? null;
    return {
      isSet: pin !== null,
      lockedUntil: isPinLocked(lockedUntil, new Date())
        ? (lockedUntil?.toISOString() ?? null)
        : null,
    };
  }

  /**
   * Sets the PIN for the first time, or replaces it when the current PIN is
   * supplied. Replacing without proving the current PIN is refused, so a
   * hijacked session cannot lock the owner out of their own money.
   */
  async setPin(userId: string, pin: string, currentPin?: string): Promise<TransactionPinStatus> {
    this.assertUsablePin(pin);

    const existing = await this.prisma.transactionPin.findUnique({ where: { userId } });
    if (existing) {
      if (!currentPin) {
        throw new BadRequestException('Enter your current PIN to change it');
      }
      await this.assertCurrentPinMatches(userId, currentPin);
    }

    const pinHash = await hash(pin, {
      type: argon2id,
      memoryCost: 65_536,
      timeCost: 3,
      parallelism: 1,
    });
    const now = new Date();
    await this.prisma.transactionPin.upsert({
      where: { userId },
      create: { userId, pinHash },
      update: { pinHash, changedAt: now, failedCount: 0, lockedUntil: null },
    });
    return { isSet: true, lockedUntil: null };
  }

  /**
   * Checks a PIN, counting failures towards a lockout. Returns nothing on
   * success: callers act on the absence of an exception.
   */
  async verifyPin(userId: string, pin: string): Promise<void> {
    await this.assertCurrentPinMatches(userId, pin);
  }

  private assertUsablePin(pin: string): void {
    if (!isValidTransactionPinShape(pin)) {
      throw new BadRequestException('Your PIN must be 4 digits');
    }
    if (isWeakTransactionPin(pin)) {
      throw new BadRequestException('Choose a less predictable PIN');
    }
  }

  private async assertCurrentPinMatches(userId: string, pin: string): Promise<void> {
    const existing = await this.prisma.transactionPin.findUnique({ where: { userId } });
    if (!existing) throw new BadRequestException('No transaction PIN has been set');

    const now = new Date();
    if (isPinLocked(existing.lockedUntil, now)) {
      throw new HttpException('Too many attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }

    if (await verify(existing.pinHash, pin)) {
      // Only write when there is something to clear, to keep the hot path cheap.
      if (existing.failedCount !== 0 || existing.lockedUntil !== null) {
        await this.prisma.transactionPin.update({
          where: { userId },
          data: { failedCount: 0, lockedUntil: null, lastUsedAt: now },
        });
      } else {
        await this.prisma.transactionPin.update({
          where: { userId },
          data: { lastUsedAt: now },
        });
      }
      return;
    }

    const next = registerFailedAttempt(existing.failedCount, now);
    await this.prisma.transactionPin.update({
      where: { userId },
      data: { failedCount: next.failedCount, lockedUntil: next.lockedUntil },
    });
    if (next.lockedUntil) {
      throw new HttpException('Too many attempts. Try again later.', HttpStatus.TOO_MANY_REQUESTS);
    }
    throw new BadRequestException('That PIN is incorrect');
  }
}
