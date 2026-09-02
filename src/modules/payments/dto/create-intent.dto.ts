import { IsEnum, IsOptional, IsUUID, Matches } from 'class-validator';
import { PaymentTargetType } from '../../../../generated/prisma/enums.js';

/**
 * What is being paid for, and — only for a top-up — how much.
 *
 * For every target that has a row of its own, the amount is read from that row
 * inside the settlement transaction rather than taken from the client, so a
 * caller cannot underpay a due by asking to. A top-up is the sole exception,
 * because there is no row to read: the user is choosing how much of their own
 * money to bring in.
 */
export class CreateIntentDto {
  @IsEnum(PaymentTargetType)
  targetType!: PaymentTargetType;

  /** The row being paid for. Absent only for a wallet top-up. */
  @IsOptional()
  @IsUUID()
  targetId?: string;

  /**
   * How much to add, for a wallet top-up only.
   *
   * This is the single case where the client may name an amount, because a
   * top-up has no target row to read one from — the user is choosing how much
   * of their own money to bring in. The service rejects it for every other
   * target type, so it cannot be used to underpay a due that has its own
   * amount. Minor units, as a string.
   */
  @IsOptional()
  @Matches(/^[1-9]\d*$/)
  amountMinor?: string;
}
