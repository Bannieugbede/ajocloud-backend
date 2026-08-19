import { IsString, Length } from 'class-validator';

export class GoogleExchangeDto {
  /** One-time handoff code delivered to the app's deep link. */
  @IsString()
  @Length(16, 128)
  code!: string;
}
