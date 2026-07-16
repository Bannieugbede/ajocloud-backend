import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { ContributionFrequency, FoodFulfilmentMethod } from '../../../../generated/prisma/enums.js';

export class CreateFoodPackageItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(160)
  name!: string;

  @Matches(/^\d{1,9}(\.\d{1,3})?$/)
  quantity!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(32)
  unit!: string;
}

export class CreateFoodPackageDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  name!: string;

  @Matches(/^[1-9]\d*$/)
  priceMinor!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => CreateFoodPackageItemDto)
  items!: CreateFoodPackageItemDto[];
}

export class CreateFoodProgrammeDto {
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  name!: string;

  @Matches(/^[1-9]\d*$/)
  contributionMinor!: string;

  @IsEnum(ContributionFrequency)
  contributionFrequency!: ContributionFrequency;

  @IsInt()
  @Min(1)
  @Max(10_000)
  enrolmentCapacity!: number;

  @IsEnum(FoodFulfilmentMethod)
  fulfilmentMethod!: FoodFulfilmentMethod;

  @IsDateString({ strict: true })
  startsAt!: string;

  @IsDateString({ strict: true })
  endsAt!: string;

  @IsOptional()
  @IsDateString()
  plannedProcurementAt?: string;

  @IsOptional()
  @IsDateString()
  distributionAt?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => CreateFoodPackageDto)
  packages!: CreateFoodPackageDto[];
}
