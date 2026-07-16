import { IsBoolean, IsObject, IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

export class UpdateFoodCoordinatorApplicationDto {
  @IsOptional()
  @IsObject()
  personalDetails?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  businessDetails?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  operatingLocation?: Record<string, unknown>;

  @IsOptional()
  @IsObject()
  fulfilmentLocations?: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(20)
  settlementBankCode?: string;

  @IsOptional()
  @IsString()
  @MinLength(4)
  @MaxLength(32)
  settlementAccountMasked?: string;

  @IsOptional()
  @IsBoolean()
  verificationConsent?: boolean;

  @IsOptional()
  @IsBoolean()
  termsAccepted?: boolean;
}
