import { IsEnum, IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { FoodFulfilmentMethod } from '../../../../generated/prisma/enums.js';

export class SubscribeFoodProgrammeDto {
  @IsUUID()
  packageId!: string;

  /**
   * Portions taken. Each one consumes a place, so this is checked against the
   * programme's remaining capacity rather than against a headcount.
   */
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(50)
  quantity: number = 1;

  @IsOptional()
  @IsEnum(FoodFulfilmentMethod)
  fulfilmentMethod?: FoodFulfilmentMethod;
}
