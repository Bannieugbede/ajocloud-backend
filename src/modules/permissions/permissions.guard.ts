import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator.js';
import type { AuthenticatedUser } from '../../common/types/authenticated-user.js';

/**
 * Roles that hold every permission implicitly. Grants are still seeded for them,
 * but a missing RolePermission row must not be able to lock the platform owner
 * out of their own console — which is exactly what happens on a database built
 * from migrations alone, since migrations create the tables and the seed (which
 * refuses to run in production) is what fills them.
 */
const UNRESTRICTED_ROLES = new Set(['SUPER_ADMIN', 'PLATFORM_ADMIN']);

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required =
      this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (required.length === 0) return true;
    const request = context
      .switchToHttp()
      .getRequest<FastifyRequest & { user?: AuthenticatedUser }>();
    if (!request.user) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }
    if (request.user.roles.some((role) => UNRESTRICTED_ROLES.has(role))) return true;
    if (!required.every((permission) => request.user?.permissions.includes(permission))) {
      throw new ForbiddenException('You do not have permission to perform this action');
    }
    return true;
  }
}
