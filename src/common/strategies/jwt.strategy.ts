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
import { User, UserStatus } from '../../users/entities/user.entity';

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
            token = request.cookies['access_token'];
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
    const userId = payload.sub;
    const user = await this.userRepository.findOne({
      where: { uid: userId },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    // Check if user is blocked
    if (user.ustatus === UserStatus.BLOCK) {
      throw new ForbiddenException(
        'Your account has been blocked. Please contact support for assistance.',
      );
    }

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
