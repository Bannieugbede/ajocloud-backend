import { IsDateString, Matches } from 'class-validator';
export class CreateAkawoScheduleDto {
  @Matches(/^[1-9]\d*$/)
  amountMinor!: string;
  @IsDateString()
  dueAt!: string;
}
