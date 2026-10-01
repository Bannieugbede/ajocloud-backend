import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';

export class FoodProgrammeQueryDto {
  @IsOptional()
  @IsIn(['ALL', 'COORDINATED'])
  scope: 'ALL' | 'COORDINATED' = 'ALL';

  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;
}
