import { IsBoolean, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class CreateFoodCoordinatorApplicationDto {
  @IsObject()
  personalDetails!: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  businessDetails?: Record<string, unknown>;

  @IsObject()
  operatingLocation!: Record<string, unknown>;

  @IsObject()
  fulfilmentLocations!: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  settlementBankCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(32)
  settlementAccountMasked?: string;

  @IsBoolean()
  verificationConsent!: boolean;

  @IsBoolean()
  termsAccepted!: boolean;
}
