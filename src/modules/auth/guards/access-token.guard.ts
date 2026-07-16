import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { FastifyRequest } from 'fastify';
import { SessionStatus, UserStatus } from '../../../../generated/prisma/enums.js';
import type { AuthenticatedUser } from '../../../common/types/authenticated-user.js';
import type { Environment } from '../../../config/env.schema.js';
import { PrismaService } from '../../../infrastructure/database/prisma.service.js';

type AuthenticatedRequest = FastifyRequest & { user?: AuthenticatedUser };
interface AccessClaims {
  readonly sub: string;
  readonly sid: string;
  readonly typ: string;
}

@Injectable()
export class AccessTokenGuard implements CanActivate {
  private readonly secret: string;

  constructor(
    private readonly jwt: JwtService,
    private readonly prisma: PrismaService,
    config: ConfigService<Environment, true>,
  ) {
    this.secret = config.get('JWT_ACCESS_SECRET', { infer: true });
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer '))
      throw new UnauthorizedException('Authentication required');
    try {
      const claims = await this.jwt.verifyAsync<AccessClaims>(authorization.slice(7), {
        secret: this.secret,
      });
      if (claims.typ !== 'access') throw new Error('invalid token type');
      const session = await this.prisma.session.findUnique({
        where: { id: claims.sid },
        include: {
          user: {
            include: {
              roleAssignments: {
                where: { OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
                include: { role: { include: { permissions: { include: { permission: true } } } } },
              },
            },
          },
        },
      });
      if (
        !session ||
        session.userId !== claims.sub ||
        session.status !== SessionStatus.ACTIVE ||
        session.expiresAt <= new Date() ||
        session.user.status !== UserStatus.ACTIVE
      )
        throw new Error('inactive session');
      const permissions = session.user.roleAssignments.flatMap((assignment) =>
        assignment.role.permissions.map((entry) => entry.permission.key),
      );
      request.user = {
        userId: claims.sub,
        sessionId: claims.sid,
        permissions: [...new Set(permissions)],
      };
      return true;
    } catch {
      throw new UnauthorizedException('Authentication required');
    }
  }
}
