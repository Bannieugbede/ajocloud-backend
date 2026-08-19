import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/**
 * Resolves the account name before linking, so the user confirms the name the
 * bank returns rather than a name they typed.
 */
export class InquireAccountDto {
  @IsString()
  @MinLength(3)
  @MaxLength(16)
  bankCode!: string;

  @IsString()
  @Matches(/^\d{10}$/, { message: 'Enter the 10-digit account number' })
  accountNumber!: string;
}
