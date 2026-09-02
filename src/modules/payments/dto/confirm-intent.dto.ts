import { IsEnum, IsString, Length, Matches } from 'class-validator';
import { PaymentMethod } from '../../../../generated/prisma/enums.js';

export class ConfirmIntentDto {
  @IsEnum(PaymentMethod)
  method!: PaymentMethod;

  /**
   * The user's 4-digit transaction PIN. Verified by TransactionPinService,
   * which locks after five consecutive failures. Never logged or persisted.
   */
  @IsString()
  @Length(4, 4)
  @Matches(/^\d{4}$/, { message: 'transactionPin must be 4 digits' })
  transactionPin!: string;
}
