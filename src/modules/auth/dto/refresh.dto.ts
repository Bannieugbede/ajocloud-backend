import { IsOptional, IsString, MinLength } from 'class-validator';

export class RefreshDto {
  /**
   * Optional for browser clients, which send the refresh token in an httpOnly
   * cookie instead. Bearer clients (mobile) still pass it in the body.
   */
  @IsOptional()
  @IsString()
  @MinLength(32)
  refreshToken?: string;
}
