import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { AkawoController } from './akawo.controller.js';
import { AkawoPoolsController } from './akawo-pools.controller.js';
import { AkawoPoolsService } from './akawo-pools.service.js';
import { AkawoService } from './akawo.service.js';

@Module({
  imports: [AuthModule],
  controllers: [AkawoController, AkawoPoolsController],
  providers: [AkawoService, AkawoPoolsService],
  exports: [AkawoPoolsService],
})
export class AkawoModule {}
