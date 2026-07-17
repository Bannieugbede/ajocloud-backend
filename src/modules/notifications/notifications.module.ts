import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env.schema.js';
import { BrevoClientService } from '../../infrastructure/external-services/brevo/brevo-client.service.js';
import { BrevoEmailProvider } from '../../infrastructure/external-services/brevo/brevo-email.provider.js';
import { BrevoSmsProvider } from '../../infrastructure/external-services/brevo/brevo-sms.provider.js';
import { TransactionalNotificationService } from './transactional-notification.service.js';
import { ConsoleEmailProvider } from './providers/console-email.provider.js';
import { ConsoleSmsProvider } from './providers/console-sms.provider.js';
import { EMAIL_PROVIDER } from './providers/email-provider.js';
import { SMS_PROVIDER } from './providers/sms-provider.js';

@Module({
  providers: [
    ConsoleEmailProvider,
    ConsoleSmsProvider,
    BrevoClientService,
    BrevoEmailProvider,
    BrevoSmsProvider,
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService, ConsoleEmailProvider, BrevoEmailProvider],
      useFactory: (
        config: ConfigService<Environment, true>,
        consoleProvider: ConsoleEmailProvider,
        brevo: BrevoEmailProvider,
      ) => (config.get('EMAIL_PROVIDER', { infer: true }) === 'brevo' ? brevo : consoleProvider),
    },
    {
      provide: SMS_PROVIDER,
      inject: [ConfigService, ConsoleSmsProvider, BrevoSmsProvider],
      useFactory: (
        config: ConfigService<Environment, true>,
        mock: ConsoleSmsProvider,
        brevo: BrevoSmsProvider,
      ) => (config.get('SMS_PROVIDER', { infer: true }) === 'brevo' ? brevo : mock),
    },
    TransactionalNotificationService,
  ],
  exports: [EMAIL_PROVIDER, SMS_PROVIDER, TransactionalNotificationService],
})
export class NotificationsModule {}
