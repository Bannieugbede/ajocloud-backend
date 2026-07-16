import {
  Equals,
  IsBoolean,
  IsEmail,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class RegisterDto {
  @IsEmail()
  @MaxLength(320)
  email!: string;

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

  @IsString()
  @Matches(/^\+234[789]\d{9}$/, {
    message: 'phone must be a Nigerian mobile number in +234 format',
  })
  phone!: string;

  @IsBoolean()
  @Equals(true)
  acceptedTerms!: boolean;

  @IsBoolean()
  @Equals(true)
  acceptedPrivacy!: boolean;
}
