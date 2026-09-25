import { IsBoolean, IsInt, IsString, Max, MaxLength, Min, MinLength } from 'class-validator';

export class JoinAjoGroupDto {
  /**
   * The code from the link: an invitation (10 characters, or 43 for one issued
   * before short links), or the group's 7-character public code when the group
   * is listed. The service decides which; the shape is only bounded here.
   */
  @IsString()
  @MinLength(7)
  @MaxLength(128)
  invitationCode!: string;

  @IsInt()
  @Min(1)
  @Max(1_000)
  requestedSlots!: number;
}

export class SetGroupListingDto {
  /** True to publish the group at its public link and in search results. */
  @IsBoolean()
  listed!: boolean;
}
