import { Module } from '@nestjs/common';
import { PublicConfigurationController } from './public-configuration.controller.js';

@Module({ controllers: [PublicConfigurationController] })
export class PublicConfigurationModule {}
