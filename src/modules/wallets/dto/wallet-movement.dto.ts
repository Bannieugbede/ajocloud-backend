import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class SendToWalletDto {
  @IsUUID()
  sourceWalletId!: string;

  /**
   * Who receives it. An email rather than a wallet id: a sender knows the
   * person, not their wallet's identifier, and letting wallet ids be looked up
   * would turn this route into an account-existence probe.
   */
  @IsString()
  @MaxLength(320)
  recipientEmail!: string;

  @Matches(/^[1-9]\d*$/)
  amountMinor!: string;

  @IsOptional()
  @IsString()
  @MaxLength(140)
  note?: string;

  /** Authorises the movement. Never logged or persisted. */
  @IsString()
  @Matches(/^\d{4}$/, { message: 'transactionPin must be 4 digits' })
  transactionPin!: string;
}

export class WithdrawDto {
  @IsUUID()
  walletId!: string;

  /** A bank account already linked and verified through KYC. */
  @IsUUID()
  bankAccountId!: string;

  @Matches(/^[1-9]\d*$/)
  amountMinor!: string;

  @IsString()
  @Matches(/^\d{4}$/, { message: 'transactionPin must be 4 digits' })
  transactionPin!: string;
}
