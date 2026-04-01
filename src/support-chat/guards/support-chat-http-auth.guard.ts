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

function parseCookie(header: string | undefined): Record<string, string> {
  if (!header) return {};
  return header.split(';').reduce<Record<string, string>>((acc, part) => {
    const [k, ...rest] = part.trim().split('=');
    if (!k || rest.length === 0) return acc;
    acc[k] = decodeURIComponent(rest.join('='));
    return acc;
  }, {});
}

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
    const cookies = parseCookie(request.headers?.cookie as string | undefined);

    const userToken = cookies['access_token'];
    const adminToken = cookies['admin_access_token'];
    const token = adminToken || userToken;
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
    if (adminToken) {
      const admin = await this.adminRepository.findOne({
        where: { admin_id: actorId },
      });
      if (!admin || admin.admin_status !== AdminStatus.ACTIVE) {
        throw new UnauthorizedException('Admin not authenticated');
      }
      actor = { type: 'admin', id: admin.admin_id, admin };
    } else {
      const user = await this.userRepository.findOne({ where: { uid: actorId } });
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
