import {
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { AjoContributionMode, ContributionFrequency } from '../../../../generated/prisma/enums.js';

export class CreateAjoGroupDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  name!: string;

  @IsEnum(ContributionFrequency)
  contributionFrequency!: ContributionFrequency;

  @IsOptional()
  @IsEnum(AjoContributionMode)
  contributionMode: AjoContributionMode = AjoContributionMode.FIXED;

  @Matches(/^[1-9]\d*$/)
  baseContributionMinor!: string;

  @IsOptional()
  @Matches(/^[1-9]\d*$/)
  contributionUnitMinor?: string;

  @IsOptional()
  @IsInt()
  @Min(2)
  @Max(1_000)
  maxMembers: number = 1_000;

  @IsInt()
  @Min(2)
  @Max(1_000)
  maxSlots!: number;

  @IsInt()
  @Min(1)
  @Max(1_000)
  requestedSlots!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000)
  minSlotsPerMember: number = 1;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(1_000)
  maxSlotsPerMember: number = 100;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  businessTimezone: string = 'Africa/Lagos';

  @IsOptional()
  @IsInt()
  @Min(0)
  contributionOpenOffsetMinutes: number = 0;

  @IsOptional()
  @IsInt()
  @Min(0)
  contributionCloseOffsetMinutes: number = 0;

  @IsOptional()
  @IsInt()
  @Min(0)
  gracePeriodMinutes: number = 0;

  @IsOptional()
  @IsInt()
  @Min(0)
  lateThresholdMinutes: number = 0;

  @IsOptional()
  @IsInt()
  @Min(0)
  payoutEligibilityCutoffMinutes: number = 0;

  @IsOptional()
  @IsInt()
  @Min(0)
  payoutOffsetMinutes: number = 0;

  @IsOptional()
  @IsInt()
  @Min(1)
  payoutProcessingWindowMinutes: number = 1_440;

  @IsDateString({ strict: true })
  startDate!: string;

  @IsDateString({ strict: true })
  endDate!: string;
}
