import {
  ForbiddenException,
  HttpException,
  Injectable,
  NestMiddleware,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { NextFunction, Request, Response } from 'express';
import { Repository } from 'typeorm';
import { UsersService } from '../users/users.service';
import { User, UserStatus } from '../users/entities/user.entity';

/**
 * Chặn mọi HTTP request mang cookie access_token khi user đã bị block.
 * Chạy sau OriginValidationMiddleware để khớp logic chọn token với JwtStrategy.
 */
@Injectable()
export class BlockedUserMiddleware implements NestMiddleware {
  constructor(
    private readonly jwtService: JwtService,
    private readonly usersService: UsersService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
  ) {}

  async use(req: Request, res: Response, next: NextFunction): Promise<void> {
    const originType = (req as any).originType || 'user';

    if (originType === 'admin') {
      return next();
    }

    const token = req.cookies?.['access_token'];
    if (!token || typeof token !== 'string') {
      return next();
    }

    try {
      const payload = await this.jwtService.verifyAsync<{ sub: number }>(token);
      const userId = payload?.sub;
      if (userId == null) {
        return next();
      }

      const user = await this.userRepository.findOne({
        where: { uid: userId },
        select: ['uid', 'ustatus'],
      });

      if (user?.ustatus === UserStatus.BLOCK) {
        this.usersService.clearAuthCookies(res);
        throw new ForbiddenException(
          'Your account has been blocked. Please contact support for assistance.',
        );
      }
    } catch (err) {
      if (err instanceof HttpException) {
        throw err;
      }
      // Token hết hạn / không hợp lệ: để JwtAuthGuard / login xử lý
      return next();
    }

    next();
  }
}
