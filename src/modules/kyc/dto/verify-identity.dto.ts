import { Equals, IsBoolean, IsEnum, IsString, Matches } from 'class-validator';

export enum IdentityKindInput {
  BVN = 'BVN',
  NIN = 'NIN',
  VNIN = 'VNIN',
}

/**
 * Step h of account creation.
 *
 * `identityNumber` is the only raw identity value the API ever accepts. It is
 * forwarded to the provider and discarded; it is never persisted (ADR-004).
 */
export class VerifyIdentityDto {
  @IsEnum(IdentityKindInput)
  kind!: IdentityKindInput;

  @IsString()
  // Digits for BVN/NIN, alphanumeric for vNIN. The exact per-kind length is
  // enforced in the domain policy, which knows which kind this is.
  @Matches(/^[A-Za-z0-9\s-]{11,20}$/, { message: 'Enter a valid identity number' })
  identityNumber!: string;

  /**
   * Must be explicitly true. A request without consent is rejected before any
   * provider call is made, and the consent is recorded.
   */
  @IsBoolean()
  @Equals(true, { message: 'Consent is required to verify your identity' })
  consent!: boolean;
}
