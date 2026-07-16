import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthService } from './health.service.js';

@ApiTags('health')
@Controller({ path: 'health', version: '1' })
export class HealthController {
  constructor(private readonly health: HealthService) {}
  @Get('live')
  live() {
    return this.health.live();
  }
  @Get('ready')
  ready() {
    return this.health.ready();
  }
}
