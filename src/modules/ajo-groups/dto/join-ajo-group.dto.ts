import { IsInt, IsString, Max, Min, MinLength } from 'class-validator';

export class JoinAjoGroupDto {
  @IsString()
  @MinLength(32)
  invitationCode!: string;

  @IsInt()
  @Min(1)
  @Max(1_000)
  requestedSlots!: number;
}
