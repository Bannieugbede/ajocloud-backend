import {
  IsBoolean,
  IsEmail,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

// Nigerian mobile numbers in E.164 +234 format (e.g. +2348012345678).
// Accepts 0801..., 801..., 234801..., +234801... on the client, which is
// normalized before it reaches this DTO.
export const NIGERIAN_PHONE_PATTERN = /^\+234[789][01]\d{8}$/;

// Validation messages are written to be shown to the visitor as-is: the web
// client renders whatever the API returns, so "email must be an email" would
// reach the person who typed it.
export class JoinWaitlistDto {
  @IsString({ message: 'Enter your first name.' })
  @MinLength(1, { message: 'Enter your first name.' })
  @MaxLength(100, { message: 'That first name is too long.' })
  firstName!: string;

  @IsString({ message: 'Enter your last name.' })
  @MinLength(1, { message: 'Enter your last name.' })
  @MaxLength(100, { message: 'That last name is too long.' })
  lastName!: string;

  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(320, { message: 'That email address is too long.' })
  email!: string;

  @IsString({ message: 'Enter your phone number.' })
  @Matches(NIGERIAN_PHONE_PATTERN, {
    message: 'Enter a valid Nigerian mobile number, e.g. 0801 234 5678.',
  })
  phone!: string;

  @IsBoolean({ message: 'Choose whether you want promotional emails.' })
  wantsPromotions!: boolean;
}

export class CreateSupportInquiryDto {
  @IsString({ message: 'Enter your name.' })
  @MinLength(1, { message: 'Enter your name.' })
  @MaxLength(200, { message: 'That name is too long.' })
  name!: string;

  @IsEmail({}, { message: 'Enter a valid email address.' })
  @MaxLength(320, { message: 'That email address is too long.' })
  email!: string;

  @IsOptional()
  @IsString({ message: 'Enter a valid phone number.' })
  @Matches(NIGERIAN_PHONE_PATTERN, {
    message: 'Enter a valid Nigerian mobile number, e.g. 0801 234 5678.',
  })
  phone?: string;

  @IsString({ message: 'Enter a subject.' })
  @MinLength(3, { message: 'The subject is too short.' })
  @MaxLength(200, { message: 'The subject is too long.' })
  subject!: string;

  @IsString({ message: 'Enter your message.' })
  @MinLength(10, { message: 'Your message needs at least 10 characters.' })
  @MaxLength(5000, { message: 'Your message is too long — keep it under 5000 characters.' })
  message!: string;
}
