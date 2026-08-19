import {
  Equals,
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

  /** E.164, e.g. +2348012345678. Stored normalised so lookups are unambiguous. */
  @IsString()
  @Matches(/^\+[1-9]\d{7,14}$/, { message: 'phone must be in international format, e.g. +234…' })
  phone!: string;

  @IsString()
  @MinLength(12)
  @MaxLength(128)
  password!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  /**
   * Optional invite code. Recorded against the account for later attribution;
   * whether it qualifies for a reward is decided by referral campaign rules,
   * not at sign-up.
   */
  @IsOptional()
  @IsString()
  @Matches(/^[A-Za-z0-9-]{4,32}$/, { message: 'referralCode must be 4-32 letters, digits or -' })
  referralCode?: string;

  @IsBoolean()
  @Equals(true)
  acceptedPrivacy!: boolean;
}
