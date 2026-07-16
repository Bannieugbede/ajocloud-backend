import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SavingsGoalType } from '../../../../generated/prisma/enums.js';

export class CreateAkawoGoalDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  name!: string;

  @IsEnum(SavingsGoalType)
  type!: SavingsGoalType;

  @IsOptional()
  @Matches(/^[1-9]\d*$/)
  targetMinor?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  targetDate?: string;
}
