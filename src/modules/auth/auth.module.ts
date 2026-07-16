import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AccessTokenGuard } from './guards/access-token.guard.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { VerificationDeliveryService } from './verification-delivery.service.js';

@Module({
  imports: [JwtModule.register({}), NotificationsModule],
  controllers: [AuthController],
  providers: [AuthService, AccessTokenGuard, VerificationDeliveryService],
  exports: [AccessTokenGuard, JwtModule],
})
export class AuthModule {}
