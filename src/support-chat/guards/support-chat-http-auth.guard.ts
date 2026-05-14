import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User, UserStatus } from '../../users/entities/user.entity';
import { Admin, AdminStatus } from '../../admins/entities/admin.entity';
import { SupportChatActor } from '../support-chat.types';
import {
  getClientOriginLike,
  parseSupportChatCookie,
  selectSupportChatToken,
  splitCommaUrls,
} from '../support-chat-auth-context.util';

@Injectable()
export class SupportChatHttpAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
    @InjectRepository(User)
    private readonly userRepository: Repository<User>,
    @InjectRepository(Admin)
    private readonly adminRepository: Repository<Admin>,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const cookies = parseSupportChatCookie(request.headers?.cookie);

    const userToken = cookies['access_token'];
    const adminToken = cookies['admin_access_token'];

    const adminFrontendUrls = splitCommaUrls(
      this.configService.get<string>('ADMIN_FRONTEND_URLS'),
    );
    const originLike = getClientOriginLike(request.headers);

    const { selectedTokenType, token } = selectSupportChatToken({
      originLike,
      adminFrontendUrls,
      userToken,
      adminToken,
      emptyOriginPolicy: 'http-legacy',
    });

    if (!token) {
      throw new UnauthorizedException('Unauthorized');
    }

    const secret =
      this.configService.get<string>('JWT_SECRET') || 'your-secret-key';
    const payload: any = await this.jwtService.verifyAsync(token, { secret });
    const actorId = Number(payload?.sub);
    if (!actorId) {
      throw new UnauthorizedException('Invalid token');
    }

    let actor: SupportChatActor | null = null;
    if (selectedTokenType === 'admin') {
      const admin = await this.adminRepository.findOne({
        where: { admin_id: actorId },
      });
      if (!admin || admin.admin_status !== AdminStatus.ACTIVE) {
        throw new UnauthorizedException('Admin not authenticated');
      }
      actor = { type: 'admin', id: admin.admin_id, admin };
    } else {
      const user = await this.userRepository.findOne({
        where: { uid: actorId },
      });
      if (!user || user.ustatus === UserStatus.BLOCK) {
        throw new UnauthorizedException('User not authenticated');
      }
      actor = { type: 'user', id: user.uid, user };
    }

    request.supportChatActor = actor;
    request.user = actor.admin || actor.user;
    return true;
  }
}
