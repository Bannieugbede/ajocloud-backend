import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Step i of account creation. */
export class LinkBankAccountDto {
  @IsString()
  @MinLength(3)
  @MaxLength(16)
  bankCode!: string;

  @IsString()
  @Matches(/^\d{10}$/, { message: 'Enter the 10-digit account number' })
  accountNumber!: string;
}
