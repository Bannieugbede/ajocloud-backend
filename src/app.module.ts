import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CsrfGuard } from './modules/auth/guards/csrf.guard.js';
import type { Environment } from './config/env.schema.js';
import { ConfigurationModule } from './config/configuration.module.js';
import { CacheModule } from './infrastructure/cache/cache.module.js';
import { DatabaseModule } from './infrastructure/database/database.module.js';
import { LoggingModule } from './infrastructure/logging/logging.module.js';
import { MessagingModule } from './infrastructure/messaging/messaging.module.js';
import { AjoGroupsModule } from './modules/ajo-groups/ajo-groups.module.js';
import { AuditModule } from './modules/audit/audit.module.js';
import { AuthModule } from './modules/auth/auth.module.js';
import { HealthModule } from './modules/health/health.module.js';
import { IdempotencyModule } from './modules/idempotency/idempotency.module.js';
import { LedgerModule } from './modules/ledger/ledger.module.js';
import { PermissionsModule } from './modules/permissions/permissions.module.js';
import { UsersModule } from './modules/users/users.module.js';
import { WalletsModule } from './modules/wallets/wallets.module.js';
import { PublicConfigurationModule } from './modules/configuration/public-configuration.module.js';
import { FoodCoordinatorApplicationsModule } from './modules/food-coordinator-applications/food-coordinator-applications.module.js';
import { BillPaymentsModule } from './modules/bill-payments/bill-payments.module.js';
import { NotificationsModule } from './modules/notifications/notifications.module.js';
import { FoodAjoModule } from './modules/food-ajo/food-ajo.module.js';
import { AkawoModule } from './modules/akawo/akawo.module.js';
import { AdminModule } from './modules/admin/admin.module.js';
import { EngagementModule } from './modules/engagement/engagement.module.js';

@Module({
  imports: [
    ConfigurationModule,
    LoggingModule,
    DatabaseModule,
    CacheModule,
    MessagingModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 120 }]),
    BullModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<Environment, true>) => ({
        connection: { url: config.get('REDIS_URL', { infer: true }) },
      }),
    }),
    AuditModule,
    IdempotencyModule,
    PermissionsModule,
    AuthModule,
    UsersModule,
    HealthModule,
    AjoGroupsModule,
    LedgerModule,
    WalletsModule,
    PublicConfigurationModule,
    FoodCoordinatorApplicationsModule,
    BillPaymentsModule,
    NotificationsModule,
    FoodAjoModule,
    AkawoModule,
    AdminModule,
    EngagementModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    // Double-submit CSRF check; only applies to cookie-authenticated requests.
    { provide: APP_GUARD, useClass: CsrfGuard },
  ],
})
export class AppModule {}
