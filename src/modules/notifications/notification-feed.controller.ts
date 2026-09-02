import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiTags } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsUUID, Max, Min } from 'class-validator';
import { CurrentUser } from '../../common/decorators/current-user.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';
import { AccessTokenGuard } from '../auth/guards/access-token.guard.js';
import { NotificationFeedService } from './notification-feed.service.js';

export class NotificationFeedQueryDto {
  @IsOptional()
  @IsUUID()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;
}

/** A user's own in-app notifications. Scoped to the caller throughout. */
@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(AccessTokenGuard)
@Controller({ path: 'notifications', version: '1' })
export class NotificationFeedController {
  constructor(private readonly feed: NotificationFeedService) {}

  @Get()
  list(@CurrentUser() user: AuthenticatedUser, @Query() query: NotificationFeedQueryDto) {
    return this.feed.list(user.userId, query);
  }

  /** Declared before ':notificationId' so the literal path is not swallowed. */
  @Post('read-all')
  markAllRead(@CurrentUser() user: AuthenticatedUser) {
    return this.feed.markAllRead(user.userId);
  }

  @Post(':notificationId/read')
  markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('notificationId', ParseUUIDPipe) notificationId: string,
  ) {
    return this.feed.markRead(user.userId, notificationId);
  }
}
