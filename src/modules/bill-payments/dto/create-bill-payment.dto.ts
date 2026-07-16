import { IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';

export class CreateBillPaymentDto {
  @IsUUID()
  walletId!: string;

  @IsUUID()
  validationId!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(120)
  customerReference!: string;

  @Matches(/^[1-9]\d*$/)
  amountMinor!: string;
}
