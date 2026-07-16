import { Global, Module } from '@nestjs/common';
import { PermissionsGuard } from './permissions.guard.js';

@Global()
@Module({ providers: [PermissionsGuard], exports: [PermissionsGuard] })
export class PermissionsModule {}
