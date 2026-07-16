import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AkawoController } from './akawo.controller.js';
import { AkawoService } from './akawo.service.js';

@Module({ imports: [AuthModule], controllers: [AkawoController], providers: [AkawoService] })
export class AkawoModule {}
