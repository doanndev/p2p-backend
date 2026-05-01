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

  // Lấy danh sách URLs được phép
  const frontendUrlsRaw =
    configService.get<string>('FRONTEND_URLS') || 'http://localhost:3000';
  const frontendUrls = frontendUrlsRaw
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url);

  const adminFrontendUrlsRaw =
    configService.get<string>('ADMIN_FRONTEND_URLS') || '';
  const adminFrontendUrls = adminFrontendUrlsRaw
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url);

  /**
   * Kiểm tra xem origin có khớp với danh sách URLs được phép không
   */
  function matchesUrls(origin: string, urls: string[]): boolean {
    if (!origin) return false;
    return urls.some((url) => {
      const normalizedUrl = url.replace(/\/$/, '');
      const regex = new RegExp(
        `^https?://([a-z0-9-]+\\.)?${normalizedUrl
          .replace('http://', '')
          .replace('https://', '')
          .replace(/\./g, '\\.')}(:\\d+)?$`,
      );
      return regex.test(origin);
    });
  }

  return async (socket: AuthenticatedSocket, next: NextFn) => {
    try {
      const cookieHeader =
        (socket.handshake.headers?.cookie as string | undefined) ?? undefined;
      const cookies = parseCookie(cookieHeader);

      // Lấy origin từ handshake headers
      const socketOrigin =
        (socket.handshake.headers.origin as string | undefined) ||
        (socket.handshake.headers.referer as string | undefined) ||
        '';

      // Xác định origin type
      const isAdminOrigin = matchesUrls(socketOrigin, adminFrontendUrls);
      const isUserOrigin = matchesUrls(socketOrigin, frontendUrls);
      const originType = isAdminOrigin ? 'admin' : 'user';

      logger?.debug(
        `[socket-auth:origin-check] ${JSON.stringify({
          socketId: socket.id,
          namespace: socket.nsp?.name,
          origin: socketOrigin,
          isAdminOrigin,
          isUserOrigin,
          originType,
        })}`,
      );

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
        // Nếu là admin token thì origin phải là admin origin
        if (!isAdminOrigin) {
          logger?.warn(
            `[socket-auth:origin-mismatch] ${JSON.stringify({
              socketId: socket.id,
              namespace: socket.nsp?.name,
              origin: socketOrigin,
              tokenType: 'admin',
              expectedOrigin: 'admin_frontend',
            })}`,
          );
          return next(
            new Error(
              'Admin token can only be used from authorized admin origins.',
            ),
          );
        }

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

      // Nếu là user token thì origin phải là user origin hoặc không có origin
      if (isAdminOrigin) {
        logger?.warn(
          `[socket-auth:origin-mismatch] ${JSON.stringify({
            socketId: socket.id,
            namespace: socket.nsp?.name,
            origin: socketOrigin,
            tokenType: 'user',
            expectedOrigin: 'frontend',
          })}`,
        );
        return next(
          new Error(
            'Invalid token type for admin origin. Please use admin credentials.',
          ),
        );
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
