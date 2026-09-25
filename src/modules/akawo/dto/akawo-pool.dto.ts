import {
  IsBoolean,
  IsDateString,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateAkawoPoolDto {
  @IsString()
  @MinLength(3, { message: 'Give the pool a name of at least 3 characters.' })
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  purpose?: string;

  /** Minor units as a decimal string, because a pool total can exceed 2^53. */
  @Matches(/^[1-9]\d*$/, { message: 'Enter an amount greater than zero.' })
  amountMinor!: string;

  /**
   * What members are asked for when they join — "Matric number" for a class,
   * "Staff ID" for an office. Defaults server-side when omitted.
   */
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  referenceLabel?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  dueAt?: string;
}

export class UpdateAkawoPoolDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  purpose?: string;

  @IsOptional()
  @IsDateString({ strict: true })
  dueAt?: string;

  /**
   * Publishes the pool at its permanent link, ajocloud.com/p/<code>, where
   * search engines can find it and anyone can join without the join code.
   */
  @IsOptional()
  @IsBoolean()
  publiclyListed?: boolean;
}

export class JoinAkawoPoolDto {
  /** The pool's join code, or its public code when the pool is listed. */
  @IsString()
  @MinLength(6)
  @MaxLength(16)
  joinCode!: string;

  /**
   * The name the organiser will reconcile against, which is not necessarily the
   * platform profile name — see ADR-007.
   */
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  fullName!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(80)
  reference!: string;
}

export class WaiveAkawoDueDto {
  @IsString()
  @MinLength(3, { message: 'Say why this member is being waived.' })
  @MaxLength(500)
  reason!: string;
}
