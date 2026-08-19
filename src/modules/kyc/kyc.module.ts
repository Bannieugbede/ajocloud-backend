import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env.schema.js';
import { DojahIdentityProvider } from '../../infrastructure/external-services/dojah/dojah-identity.provider.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { KycController } from './kyc.controller.js';
import { KycService } from './kyc.service.js';
import { IDENTITY_PROVIDER } from './providers/identity-provider.js';
import { MockIdentityProvider } from './providers/mock-identity.provider.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [KycController],
  providers: [
    KycService,
    MockIdentityProvider,
    DojahIdentityProvider,
    {
      provide: IDENTITY_PROVIDER,
      inject: [ConfigService, MockIdentityProvider, DojahIdentityProvider],
      // Dojah is used only when explicitly selected. Anything else, including
      // an unset value, falls back to the mock, which never reports a
      // real-world identity as verified.
      useFactory: (
        config: ConfigService<Environment, true>,
        mock: MockIdentityProvider,
        dojah: DojahIdentityProvider,
      ) => (config.get('KYC_PROVIDER', { infer: true }) === 'dojah' ? dojah : mock),
    },
  ],
  exports: [KycService],
})
export class KycModule {}
