import {
  IsDateString,
  IsEnum,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { ContributionFrequency } from '../../../../generated/prisma/enums.js';

export class CreateAjoGroupDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  name!: string;

  @IsEnum(ContributionFrequency)
  contributionFrequency!: ContributionFrequency;

  @Matches(/^[1-9]\d*$/)
  baseContributionMinor!: string;

  @IsInt()
  @Min(2)
  @Max(1_000)
  maxSlots!: number;

  @IsInt()
  @Min(1)
  @Max(100)
  requestedSlots!: number;

  @IsDateString({ strict: true })
  startDate!: string;

  @IsDateString({ strict: true })
  endDate!: string;
}
