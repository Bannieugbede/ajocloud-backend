import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env.schema.js';
import { ResendClientService } from '../../infrastructure/external-services/resend/resend-client.service.js';
import { ResendEmailProvider } from '../../infrastructure/external-services/resend/resend-email.provider.js';
import { NotificationPreferencesService } from './notification-preferences.service.js';
import { TransactionalNotificationService } from './transactional-notification.service.js';
import { ExpoPushProvider } from '../../infrastructure/external-services/expo/expo-push.provider.js';
import { DevicesModule } from '../devices/devices.module.js';
import { ConsoleEmailProvider } from './providers/console-email.provider.js';
import { ConsolePushProvider } from './providers/console-push.provider.js';
import { PUSH_PROVIDER } from './providers/push-provider.js';
import { ConsoleSmsProvider } from './providers/console-sms.provider.js';
import { EMAIL_PROVIDER } from './providers/email-provider.js';
import { SMS_PROVIDER } from './providers/sms-provider.js';

@Module({
  imports: [DevicesModule],
  providers: [
    NotificationPreferencesService,
    ConsoleEmailProvider,
    ConsolePushProvider,
    ExpoPushProvider,
    ConsoleSmsProvider,
    ResendClientService,
    ResendEmailProvider,
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService, ConsoleEmailProvider, ResendEmailProvider],
      useFactory: (
        config: ConfigService<Environment, true>,
        consoleProvider: ConsoleEmailProvider,
        resend: ResendEmailProvider,
      ) => (config.get('EMAIL_PROVIDER', { infer: true }) === 'resend' ? resend : consoleProvider),
    },
    {
      // No hosted SMS provider is wired yet; the console provider keeps the
      // channel contract intact until one is selected.
      provide: SMS_PROVIDER,
      useExisting: ConsoleSmsProvider,
    },
    {
      provide: PUSH_PROVIDER,
      inject: [ConfigService, ConsolePushProvider, ExpoPushProvider],
      useFactory: (
        config: ConfigService<Environment, true>,
        consoleProvider: ConsolePushProvider,
        expo: ExpoPushProvider,
      ) => (config.get('PUSH_PROVIDER', { infer: true }) === 'expo' ? expo : consoleProvider),
    },
    TransactionalNotificationService,
  ],
  exports: [
    EMAIL_PROVIDER,
    SMS_PROVIDER,
    TransactionalNotificationService,
    NotificationPreferencesService,
  ],
})
export class NotificationsModule {}
