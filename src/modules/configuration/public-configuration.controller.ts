import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { AJO_CLOUD_BRAND } from './brand.config.js';

@ApiTags('configuration')
@Controller({ path: 'configuration', version: '1' })
export class PublicConfigurationController {
  @Get('brand')
  brand(): typeof AJO_CLOUD_BRAND {
    return AJO_CLOUD_BRAND;
  }
}
