import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/** Non-financial fields may be changed while a group is still being filled. */
export class UpdateAjoGroupProfileDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  description?: string;
}
