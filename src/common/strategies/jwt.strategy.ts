import {
  Injectable,
  UnauthorizedException,
  ForbiddenException,
} from '@nestjs/common';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from '../../users/entities/user.entity';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    private configService: ConfigService,
    @InjectRepository(User)
    private userRepository: Repository<User>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request) => {
          let token = null;
          if (request && request.cookies) {
            // Kiểm tra origin type để lấy token phù hợp
            const originType = (request as any).originType || 'user';

            // Nếu request từ admin origin, lấy admin_access_token
            if (originType === 'admin') {
              token = request.cookies['admin_access_token'];
            } else {
              // Nếu request từ user origin, lấy access_token
              token = request.cookies['access_token'];
            }
          }
          return token;
        },
      ]),
      ignoreExpiration: false,
      secretOrKey: configService.get<string>('JWT_SECRET') || 'your-secret-key',
      passReqToCallback: true, // Enable passing request to validate method
    });
  }

  async validate(request: any, payload: any): Promise<User> {
    const originType = (request as any).originType || 'user';
    const userId = payload.sub;
    const user = await this.userRepository.findOne({
      where: { uid: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Nếu request đến từ admin origin nhưng token không phải admin token thì reject
    // (Admin access_token sẽ được xử lý bởi AdminJwtStrategy)
    if (originType === 'admin') {
      throw new UnauthorizedException(
        'Invalid token type for admin origin. Please use admin credentials.',
      );
    }

    // Trạng thái block được kiểm tra tập trung ở BlockedUserMiddleware

    // Check email activation - but allow bypass for verify email endpoints
    const shouldBypassEmailCheck = request?._emailVerificationBypass === true;
    if (!shouldBypassEmailCheck && !user.u_active_email) {
      throw new ForbiddenException(
        'Email is not activated. Please activate your email to continue.',
      );
    }

    return user;
  }
}
