import { IsString, IsUUID, Matches } from 'class-validator';

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
}
