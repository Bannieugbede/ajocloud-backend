import {
  IsDateString,
  IsObject,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class ReviewFoodCoordinatorApplicationDto {
  @IsString()
  @MinLength(3)
  @MaxLength(2_000)
  notes!: string;

  @IsOptional()
  @IsObject()
  riskResult?: Record<string, unknown>;
}

export class ApproveFoodCoordinatorApplicationDto extends ReviewFoodCoordinatorApplicationDto {
  @IsString()
  @MinLength(3)
  @MaxLength(191)
  identityVerificationRef!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(191)
  settlementVerificationRef!: string;

  @IsString()
  @MinLength(3)
  @MaxLength(191)
  riskAssessmentRef!: string;

  @IsDateString({ strict: true })
  expiresAt!: string;
}
