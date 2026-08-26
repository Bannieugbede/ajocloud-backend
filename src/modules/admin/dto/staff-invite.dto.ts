import { IsEmail, IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { INVITABLE_ROLES } from '../staff/staff-roles.js';

export class InviteStaffDto {
  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(320)
  email!: string;

  @IsString()
  @MinLength(1, { message: 'Enter their first name.' })
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MinLength(1, { message: 'Enter their last name.' })
  @MaxLength(100)
  lastName!: string;

  @IsIn(INVITABLE_ROLES, { message: 'Choose a role that can be invited.' })
  role!: (typeof INVITABLE_ROLES)[number];
}

/** Sent by the unauthenticated accept page; the token comes from the email. */
export class AcceptStaffInviteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(256)
  token!: string;

  /** Same policy as registration, so an invite cannot create a weak account. */
  @IsString({ message: 'Choose a password.' })
  @MinLength(12, { message: 'Use at least 12 characters.' })
  @MaxLength(128, { message: 'That password is too long.' })
  password!: string;
}
