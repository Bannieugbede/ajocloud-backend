import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class ValidateBillCustomerDto {
  @IsUUID()
  billerId!: string;

  @IsOptional()
  @IsUUID()
  productId?: string;

  @IsString()
  @MinLength(3)
  @MaxLength(120)
  customerReference!: string;
}
