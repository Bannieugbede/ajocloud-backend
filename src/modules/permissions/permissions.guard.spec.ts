import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PERMISSIONS_KEY } from '../../common/decorators/permissions.decorator.js';
import { PermissionsGuard } from './permissions.guard.js';

function contextFor(user: unknown): ExecutionContext {
  return {
    getHandler: () => () => undefined,
    getClass: () => class {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

function guardRequiring(required: string[] | undefined): PermissionsGuard {
  const reflector = new Reflector();
  jest
    .spyOn(reflector, 'getAllAndOverride')
    .mockImplementation((key) => (key === PERMISSIONS_KEY ? required : undefined));
  return new PermissionsGuard(reflector);
}

describe('PermissionsGuard', () => {
  it('allows a route that requires nothing', () => {
    expect(guardRequiring([]).canActivate(contextFor(undefined))).toBe(true);
  });

  it('allows a user holding every required permission', () => {
    const guard = guardRequiring(['staff.manage']);
    const context = contextFor({ roles: ['SUPPORT_OFFICER'], permissions: ['staff.manage'] });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('rejects a user missing a required permission', () => {
    const guard = guardRequiring(['staff.manage']);
    const context = contextFor({ roles: ['SUPPORT_OFFICER'], permissions: ['users.read'] });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });

  it('rejects an unauthenticated request', () => {
    const guard = guardRequiring(['staff.manage']);
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(ForbiddenException);
  });

  // The reason the bypass exists: a database built from migrations alone has no
  // RolePermission rows, which would otherwise lock the owner out of their own
  // console.
  it.each(['SUPER_ADMIN', 'PLATFORM_ADMIN'])(
    'allows %s even with no permissions granted',
    (role) => {
      const guard = guardRequiring(['staff.manage']);
      expect(guard.canActivate(contextFor({ roles: [role], permissions: [] }))).toBe(true);
    },
  );

  it('does not extend the bypass to other roles', () => {
    const guard = guardRequiring(['staff.manage']);
    const context = contextFor({ roles: ['COMPLIANCE_OFFICER'], permissions: [] });
    expect(() => guard.canActivate(context)).toThrow(ForbiddenException);
  });
});
