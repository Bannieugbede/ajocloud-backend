import { IsString, Matches, MinLength } from 'class-validator';

export class PayContributionDto {
  /**
   * Minor units as a string, matching the repository-wide convention for money
   * crossing the wire: a JSON number would lose precision above 2^53.
   */
  @Matches(/^[1-9]\d{0,18}$/, {
    message: 'amountMinor must be a positive integer in minor units',
  })
  amountMinor!: string;

  /**
   * Supplied by the caller so a retried request settles once. It is scoped to
   * the schedule server-side, so one client key cannot be reused across
   * different contributions.
   */
  @IsString()
  @MinLength(8)
  idempotencyKey!: string;
}
