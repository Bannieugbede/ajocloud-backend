import { IsEnum, IsString, IsUUID, Matches } from 'class-validator';
import { AccountVerificationChannel } from '../../../../generated/prisma/enums.js';

export class VerifyAccountDto {
  @IsUUID()
  userId!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class ResendVerificationDto {
  @IsUUID()
  userId!: string;

  @IsEnum(AccountVerificationChannel)
  channel!: AccountVerificationChannel;
}
