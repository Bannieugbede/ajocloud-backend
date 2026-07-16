import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateSwapRequestDto {
  @IsUUID()
  fromSlotId!: string;

  @IsUUID()
  toSlotId!: string;

  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason?: string;
}

export class DecideSwapRequestDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
