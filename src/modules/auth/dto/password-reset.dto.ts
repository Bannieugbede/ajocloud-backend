import { IsEmail, IsString, IsUUID, Length, MaxLength, MinLength } from 'class-validator';

export class RequestPasswordResetDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;
}

export class CompletePasswordResetDto {
  @IsUUID()
  challengeId!: string;

  @IsString()
  @Length(6, 6)
  code!: string;

  /** Same policy as registration, so a reset cannot weaken an account. */
  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;
}
