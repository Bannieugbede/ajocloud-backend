import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { PaymentTargetType } from '../../../../generated/prisma/enums.js';

/**
 * What is being paid for — deliberately not how much.
 *
 * There is no amount field, and adding one would be a vulnerability rather than
 * a convenience: the amount is read from the target row inside the settlement
 * transaction, so a caller cannot underpay a due by asking to.
 */
export class CreateIntentDto {
  @IsEnum(PaymentTargetType)
  targetType!: PaymentTargetType;

  /** The row being paid for. Absent only for a wallet top-up. */
  @IsOptional()
  @IsUUID()
  targetId?: string;
}
