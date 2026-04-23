import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { User, UserStatus } from '../../users/entities/user.entity';
import { Admin, AdminStatus } from '../../admins/entities/admin.entity';

export type SocketActor =
  | { type: 'user'; id: number; user?: User }
  | { type: 'admin'; id: number; admin?: Admin };

export type AuthenticatedSocket = Socket & {
  user_id?: number;
  actor?: SocketActor;
};

type NextFn = (err?: Error) => void;

interface CreateSocketAuthMiddlewareOptions {
  jwtService: JwtService;
  configService: ConfigService;
  userRepository: Repository<User>;
  adminRepository: Repository<Admin>;
  includeEntityOnActor?: boolean;
  logger?: Logger;
}

function parseCookie(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return header.split(';').reduce<Record<string, string>>((acc, part) => {
    const [k, ...rest] = part.trim().split('=');
    if (!k || rest.length === 0) return acc;
    acc[k] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

export function createSocketAuthMiddleware(
  options: CreateSocketAuthMiddlewareOptions,
) {
  const {
    jwtService,
    configService,
    userRepository,
    adminRepository,
    includeEntityOnActor = false,
    logger,
  } = options;

  return async (socket: AuthenticatedSocket, next: NextFn) => {
    try {
      const cookieHeader =
        (socket.handshake.headers?.cookie as string | undefined) ?? undefined;
      const cookies = parseCookie(cookieHeader);

      const userToken =
        (socket.handshake.auth?.access_token as string | undefined) ||
        cookies['access_token'];
      const adminToken =
        (socket.handshake.auth?.admin_access_token as string | undefined) ||
        cookies['admin_access_token'];
      const token = adminToken || userToken;
      if (!token) {
        return next(new Error('unauthorized'));
      }

      const secret =
        configService.get<string>('JWT_SECRET') || 'your-secret-key';
      const payload: any = await jwtService.verifyAsync(token, { secret });
      const actorId = Number(payload?.sub);
      if (!actorId) {
        return next(new Error('unauthorized'));
      }

      if (adminToken) {
        const admin = await adminRepository.findOne({
          where: { admin_id: actorId },
        });
        if (!admin || admin.admin_status !== AdminStatus.ACTIVE) {
          return next(new Error('unauthorized'));
        }
        socket.user_id = admin.admin_id;
        socket.actor = includeEntityOnActor
          ? { type: 'admin', id: admin.admin_id, admin }
          : { type: 'admin', id: admin.admin_id };
        return next();
      }

      const user = await userRepository.findOne({
        where: { uid: actorId },
      });
      if (!user || user.ustatus === UserStatus.BLOCK) {
        return next(new Error('unauthorized'));
      }
      socket.user_id = user.uid;
      socket.actor = includeEntityOnActor
        ? { type: 'user', id: user.uid, user }
        : { type: 'user', id: user.uid };
      return next();
    } catch (error: any) {
      logger?.warn(
        `[socket-auth:reject] ${JSON.stringify({
          socketId: socket.id,
          namespace: socket.nsp?.name,
          name: error?.name,
          message: error?.message,
        })}`,
      );
      return next(new Error('unauthorized'));
    }
  };
}
