import {
  CanActivate,
  ExecutionContext,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  UseGuards,
  applyDecorators,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';
import type { KycAction } from '../domain/kyc-stage-policy.js';
import { assertKycStage } from '../kyc-facts.js';

export const KYC_ACTION_KEY = 'kycAction';

/**
 * Refuses the route unless the caller has completed the verification stage
 * `action` needs (ADR-015), with a 403 coded `KYC_STAGE_REQUIRED`.
 *
 * Applies its own guard, and a method guard runs after the class's, so the
 * access-token guard has already put the caller on the request.
 */
export function RequireKycStage(action: KycAction): MethodDecorator & ClassDecorator {
  return applyDecorators(SetMetadata(KYC_ACTION_KEY, action), UseGuards(KycStageGuard));
}

/**
 * Only Reflector and the global PrismaService, so any module can use it
 * without importing the KYC module.
 */
@Injectable()
export class KycStageGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const action = this.reflector.getAllAndOverride<KycAction | undefined>(KYC_ACTION_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!action) return true;
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: AuthenticatedUser }>();
    // Fail closed: a gated route reached without a caller is a wiring mistake.
    if (!request.user) throw new UnauthorizedException();
    await assertKycStage(this.prisma, request.user.userId, action);
    return true;
  }
}
