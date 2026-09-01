import { IsEnum, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';
import { KycTier } from '../../../../generated/prisma/enums.js';

/**
 * A decision that is not an approval must carry a reason: it reaches the
 * applicant and is the compliance record of why the profile was refused or
 * escalated.
 */
export class ReviewKycProfileDto {
  @IsString()
  @MinLength(3)
  @MaxLength(1_000)
  reason!: string;
}

export class ApproveKycProfileDto {
  /**
   * The tier being granted. It is explicit rather than inferred so the reviewer
   * states what they intend to unlock, and the service can refuse a tier the
   * profile's passed checks do not support.
   */
  @IsEnum(KycTier)
  tier!: KycTier;

  @IsOptional()
  @IsString()
  @MaxLength(1_000)
  reason?: string;
}
