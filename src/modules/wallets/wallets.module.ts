import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { WalletsController } from './wallets.controller.js';
import { WalletsService } from './wallets.service.js';

@Module({ imports: [AuthModule], controllers: [WalletsController], providers: [WalletsService] })
export class WalletsModule {}
