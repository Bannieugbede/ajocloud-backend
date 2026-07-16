import { Global, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { validateEnvironment } from './env.schema.js';

@Global()
@Module({
  imports: [
    ConfigModule.forRoot({
      cache: true,
      expandVariables: false,
      isGlobal: true,
      validate: validateEnvironment,
    }),
  ],
  exports: [ConfigModule],
})
export class ConfigurationModule {}
