import { IsOptional, IsString, Matches } from 'class-validator';

const PIN_PATTERN = /^\d{4}$/;

export class SetTransactionPinDto {
  @IsString()
  @Matches(PIN_PATTERN, { message: 'pin must be 4 digits' })
  pin!: string;

  /** Required only when replacing an existing PIN. */
  @IsOptional()
  @IsString()
  @Matches(PIN_PATTERN, { message: 'currentPin must be 4 digits' })
  currentPin?: string;
}

export class VerifyTransactionPinDto {
  @IsString()
  @Matches(PIN_PATTERN, { message: 'pin must be 4 digits' })
  pin!: string;
}
