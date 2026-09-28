import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Stage 3: the address on the person's NIN record, as they would write it. */
export class VerifyAddressDto {
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  addressLine!: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  city!: string;

  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  lga?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(100)
  state!: string;
}
