import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { GoogleOAuthService } from './google-oauth.service.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { PasswordResetService } from './password-reset.service.js';
import { PasswordlessService } from './passwordless.service.js';
import { TransactionPinService } from './transaction-pin.service.js';
import { VerificationDeliveryService } from './verification-delivery.service.js';

@Module({
  imports: [JwtModule.register({}), NotificationsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AccessTokenGuard,
    GoogleOAuthService,
    PasswordResetService,
    PasswordlessService,
    TransactionPinService,
    VerificationDeliveryService,
  ],
  exports: [AccessTokenGuard, JwtModule, TransactionPinService],
})
export class AuthModule {}
