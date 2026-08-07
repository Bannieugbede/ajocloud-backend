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

export class JoinWaitlistDto {
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  firstName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(100)
  lastName!: string;

  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsString()
  @Matches(NIGERIAN_PHONE_PATTERN, {
    message: 'phone must be a valid Nigerian number in +234 format',
  })
  phone!: string;

  @IsBoolean()
  wantsPromotions!: boolean;
}

export class CreateSupportInquiryDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  name!: string;

  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsOptional()
  @IsString()
  @Matches(NIGERIAN_PHONE_PATTERN, {
    message: 'phone must be a valid Nigerian number in +234 format',
  })
  phone?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  subject!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(5000)
  message!: string;
}
