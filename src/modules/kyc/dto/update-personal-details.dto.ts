import { Type } from 'class-transformer';
import { IsDate, IsEnum, IsString, MaxLength, MinLength } from 'class-validator';

export enum GenderInput {
  MALE = 'MALE',
  FEMALE = 'FEMALE',
  OTHER = 'OTHER',
  PREFER_NOT_TO_SAY = 'PREFER_NOT_TO_SAY',
}

/** Step g of account creation. Ordinary profile data, not identity numbers. */
export class UpdatePersonalDetailsDto {
  @Type(() => Date)
  @IsDate()
  dateOfBirth!: Date;

  @IsEnum(GenderInput)
  gender!: GenderInput;

  @IsString()
  @MinLength(3)
  @MaxLength(200)
  addressLine!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  state!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(120)
  occupation!: string;
}
