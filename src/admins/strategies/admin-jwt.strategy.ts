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
import { Admin, AdminStatus } from '../entities/admin.entity';

@Injectable()
export class AdminJwtStrategy extends PassportStrategy(Strategy, 'admin-jwt') {
  constructor(
    private configService: ConfigService,
    @InjectRepository(Admin)
    private adminRepository: Repository<Admin>,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromExtractors([
        (request) => {
          let token = null;
          if (request && request.cookies) {
            // Ưu tiên lấy admin_access_token nếu có
            token = request.cookies['admin_access_token'];

            // Nếu không có admin_access_token, kiểm tra xem đây có phải admin origin không
            // Nếu là admin origin thì reject (vì phải có admin_access_token)
            if (!token) {
              const originType = (request as any).originType || 'user';
              if (originType === 'admin') {
                // Origin là admin nhưng không có token admin -> invalid
                // Hãy để code tiếp theo xử lý lỗi
              }
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

  async validate(request: any, payload: any): Promise<Admin> {
    const originType = (request as any).originType || 'user';
    const adminId = payload.sub;
    const admin = await this.adminRepository.findOne({
      where: { admin_id: adminId },
    });

    if (!admin) {
      throw new UnauthorizedException('Admin not found');
    }

    // Nếu request không đến từ admin origin thì reject (bảo vệ)
    // Chỉ cho phép admin token từ admin origins
    if (originType !== 'admin') {
      throw new UnauthorizedException(
        'Admin token can only be used from authorized admin origins.',
      );
    }

    // Check if admin is active
    if (admin.admin_status !== AdminStatus.ACTIVE) {
      throw new ForbiddenException('Admin account is not active');
    }

    return admin;
  }
}
