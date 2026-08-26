import { IsOptional, IsString, MaxLength, MinLength, Matches } from 'class-validator';

/**
 * What a staff member may change about themselves.
 *
 * Deliberately narrow: email, roles and account status are not here. Changing
 * the address a session is tied to, or the role that decides what someone can
 * see, is an administrative action rather than a profile edit, and allowing it
 * here would let anyone widen their own access.
 */
export class UpdateProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Enter your first name.' })
  @MaxLength(100)
  firstName?: string;

  @IsOptional()
  @IsString()
  @MinLength(1, { message: 'Enter your last name.' })
  @MaxLength(100)
  lastName?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  otherNames?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  occupation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  addressLine?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  city?: string;

  @IsOptional()
  @IsString()
  @MaxLength(100)
  state?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsString()
  @MaxLength(2048)
  @Matches(/^https:\/\//, { message: 'The avatar URL must start with https://' })
  avatarUrl?: string;

  /** E.164, the same shape the rest of the platform stores phone numbers in. */
  @IsOptional()
  @IsString()
  @Matches(/^\+[1-9]\d{6,14}$/, {
    message: 'Enter a phone number in international format, e.g. +2348012345678.',
  })
  phone?: string;
}
