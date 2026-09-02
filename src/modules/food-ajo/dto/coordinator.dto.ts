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
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { FoodAjoStatus } from '../../../../generated/prisma/enums.js';

/** Lifecycle moves a coordinator may ask for. The transition itself is checked
    against the current status by the policy, not by this list. */
export class TransitionProgrammeDto {
  @IsEnum(FoodAjoStatus)
  status!: FoodAjoStatus;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class PurchaseOrderItemDto {
  @IsString()
  @MinLength(1)
  @MaxLength(255)
  description!: string;

  /** Decimal string to the column's precision: a float would not survive the
      round trip for quantities such as 2.5kg. */
  @Matches(/^\d{1,9}(\.\d{1,3})?$/)
  quantity!: string;

  @Matches(/^[1-9]\d*$/)
  unitPriceMinor!: string;
}

export class CreatePurchaseOrderDto {
  @IsUUID()
  vendorId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => PurchaseOrderItemDto)
  items!: PurchaseOrderItemDto[];
}

export class TransitionPurchaseOrderDto {
  @IsEnum(['SUBMITTED', 'CONFIRMED', 'FULFILLED', 'CANCELLED'])
  status!: 'SUBMITTED' | 'CONFIRMED' | 'FULFILLED' | 'CANCELLED';
}

/**
 * A receipt is recorded by reference, never by upload through this route: the
 * file itself goes to object storage, and only its key and content hash are
 * persisted so the record cannot be altered without detection.
 */
export class RecordReceiptDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  storageKey!: string;

  @Matches(/^[a-f0-9]{64}$/)
  contentHash!: string;

  @IsDateString({ strict: true })
  receivedAt!: string;
}

export class CreateDistributionDto {
  @IsDateString({ strict: true })
  scheduledAt!: string;
}

export class TransitionDistributionDto {
  @IsEnum(['READY', 'DISTRIBUTING', 'COMPLETED', 'CANCELLED'])
  status!: 'READY' | 'DISTRIBUTING' | 'COMPLETED' | 'CANCELLED';
}

/** A member presents the code they were issued; the coordinator types it in. */
export class ConfirmCollectionDto {
  @IsString()
  @MinLength(1)
  @MaxLength(32)
  code!: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  evidenceStorageKey?: string;
}

export class UpdateFoodPackageDto {
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @Matches(/^[1-9]\d*$/)
  priceMinor?: string;
}

export class CreateVendorDto {
  @IsString()
  @MinLength(2)
  @MaxLength(160)
  name!: string;

  @IsOptional()
  @IsString()
  @MaxLength(320)
  contactEmail?: string;

  @IsOptional()
  @IsString()
  @MaxLength(32)
  contactPhone?: string;
}

export class VendorQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;
}
