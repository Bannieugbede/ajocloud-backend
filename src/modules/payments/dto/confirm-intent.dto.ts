import {
  IsEnum,
  IsOptional,
  IsString,
  Length,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
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

  /**
   * The customer's number for a bill payment: the phone, meter or smartcard
   * number the payment quotes. Only a digest of it is stored, so the provider
   * can only be sent it here. Checked against the validation before the PIN,
   * used for this one request, and never logged or persisted.
   */
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(120)
  customerReference?: string;
}
