import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Environment } from '../../config/env.schema.js';
import { MonnifyIdentityProvider } from '../../infrastructure/external-services/monnify/monnify-identity.provider.js';
import { AuditModule } from '../audit/audit.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { AdminKycReviewController } from './admin-kyc-review.controller.js';
import { KycController } from './kyc.controller.js';
import { KycReviewService } from './kyc-review.service.js';
import { KycService } from './kyc.service.js';
import { IDENTITY_PROVIDER } from './providers/identity-provider.js';
import { MockIdentityProvider } from './providers/mock-identity.provider.js';
import { SandboxFallbackIdentityProvider } from './providers/sandbox-fallback-identity.provider.js';

@Module({
  imports: [AuthModule, AuditModule],
  controllers: [KycController, AdminKycReviewController],
  providers: [
    KycService,
    KycReviewService,
    MockIdentityProvider,
    MonnifyIdentityProvider,
    {
      provide: IDENTITY_PROVIDER,
      inject: [ConfigService, MockIdentityProvider, MonnifyIdentityProvider],
      // Monnify is used only when explicitly selected. Anything else, including
      // an unset value, falls back to the mock, which never reports a
      // real-world identity as verified.
      //
      // With KYC_SANDBOX_FALLBACK the selected provider is wrapped so that a
      // sandbox-side failure falls through to the mock, letting mobile testing
      // proceed on test keys. Every such result is flagged SANDBOX_FALLBACK and
      // attributed to the mock. The environment schema refuses that flag in
      // production, so the wrapper cannot exist there. See ADR-006.
      useFactory: (
        config: ConfigService<Environment, true>,
        mock: MockIdentityProvider,
        monnify: MonnifyIdentityProvider,
      ) => {
        const selected = config.get('KYC_PROVIDER', { infer: true }) === 'monnify' ? monnify : mock;
        if (selected === mock || !config.get('KYC_SANDBOX_FALLBACK', { infer: true })) {
          return selected;
        }
        return new SandboxFallbackIdentityProvider(selected, mock);
      },
    },
  ],
  exports: [KycService, KycReviewService],
})
export class KycModule {}
