import { IsInt, IsOptional, Max, Min } from 'class-validator';
import { MAX_INVITATION_USES } from '../domain/group-invitation-policy.js';

export class CreateGroupInvitationDto {
  /**
   * How many people may redeem this one link.
   *
   * Defaults to a single use, which is the safe reading of "invite someone":
   * a link that quietly admitted the whole of a forwarded group chat would be
   * a surprise. Sharing to a wider audience is deliberate, not the default.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(MAX_INVITATION_USES)
  maxUses: number = 1;
}
