import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { Logger } from '@nestjs/common';
import { Socket } from 'socket.io';
import { Repository } from 'typeorm';
import { User, UserStatus } from '../../users/entities/user.entity';
import { Admin, AdminStatus } from '../../admins/entities/admin.entity';
import {
  getClientOriginLike,
  matchesSupportChatOriginUrl,
  parseSupportChatCookie,
  selectSupportChatToken,
  splitCommaUrls,
} from '../../support-chat/support-chat-auth-context.util';

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

  const frontendUrls = splitCommaUrls(
    configService.get<string>('FRONTEND_URLS') || 'http://localhost:3000',
  );
  const adminFrontendUrls = splitCommaUrls(
    configService.get<string>('ADMIN_FRONTEND_URLS'),
  );

  return async (socket: AuthenticatedSocket, next: NextFn) => {
    try {
      const cookieHeader =
        (socket.handshake.headers?.cookie as string | undefined) ?? undefined;
      const cookies = parseSupportChatCookie(cookieHeader);

      const socketOrigin = getClientOriginLike(socket.handshake.headers);

      const isAdminOrigin = matchesSupportChatOriginUrl(
        socketOrigin,
        adminFrontendUrls,
      );
      const isUserOrigin = matchesSupportChatOriginUrl(
        socketOrigin,
        frontendUrls,
      );
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

      const { selectedTokenType, token } = selectSupportChatToken({
        originLike: socketOrigin,
        adminFrontendUrls,
        userToken,
        adminToken,
        emptyOriginPolicy: 'socket',
      });

      logger?.debug(
        `[socket-auth:token-selection] ${JSON.stringify({
          socketId: socket.id,
          namespace: socket.nsp?.name,
          origin: socketOrigin,
          isAdminOrigin,
          isUserOrigin,
          hasUserToken: Boolean(userToken),
          hasAdminToken: Boolean(adminToken),
          selectedTokenType,
          selectedTokenPresent: Boolean(token),
        })}`,
      );

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

      if (selectedTokenType === 'admin') {
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
