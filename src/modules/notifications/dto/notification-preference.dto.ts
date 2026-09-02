import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { NotificationChannel } from '../../../../generated/prisma/enums.js';
import { NOTIFICATION_TOPICS } from '../domain/notification-topics.js';

export class UpdateNotificationPreferenceDto {
  /** Constrained to the catalogue so a typo cannot store a preference that
      governs nothing and is never read. */
  @IsEnum(NOTIFICATION_TOPICS)
  topic!: (typeof NOTIFICATION_TOPICS)[number];

  @IsEnum(NotificationChannel)
  channel!: NotificationChannel;

  @IsBoolean()
  enabled!: boolean;

  /** Minutes from midnight in `timezone`. Both ends are set together or not at
      all; one end alone describes no window. */
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 60 - 1)
  quietHoursStartMinutes?: number | null;

  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(24 * 60 - 1)
  quietHoursEndMinutes?: number | null;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;
}

export class UpdateNotificationPreferencesDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdateNotificationPreferenceDto)
  preferences!: UpdateNotificationPreferenceDto[];
}
