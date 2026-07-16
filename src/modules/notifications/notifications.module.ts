import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env.schema.js';
import { BrevoEmailProvider } from '../../infrastructure/external-services/brevo/brevo-email.provider.js';
import { ConsoleEmailProvider } from './providers/console-email.provider.js';
import { EMAIL_PROVIDER } from './providers/email-provider.js';

@Module({
  providers: [
    ConsoleEmailProvider,
    BrevoEmailProvider,
    {
      provide: EMAIL_PROVIDER,
      inject: [ConfigService, ConsoleEmailProvider, BrevoEmailProvider],
      useFactory: (
        config: ConfigService<Environment, true>,
        consoleProvider: ConsoleEmailProvider,
        brevo: BrevoEmailProvider,
      ) => (config.get('EMAIL_PROVIDER', { infer: true }) === 'brevo' ? brevo : consoleProvider),
    },
  ],
  exports: [EMAIL_PROVIDER],
})
export class NotificationsModule {}
