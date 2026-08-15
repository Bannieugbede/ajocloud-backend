import { IsEmail, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class RequestOtpDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class VerifyOtpDto {
  @IsUUID()
  challengeId!: string;

  @IsString()
  @Matches(/^\d{6}$/)
  code!: string;
}

export class ResendOtpDto {
  @IsUUID()
  challengeId!: string;
}
