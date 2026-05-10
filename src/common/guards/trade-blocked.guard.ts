import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { User, UserStatus } from '../../users/entities/user.entity';

/**
 * Chặn user có `ustatus === block_trade` khỏi route P2P (đặt sau JwtAuthGuard).
 */
@Injectable()
export class TradeBlockedGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<{ user?: User }>();
    const user = req.user;
    if (!user) {
      return true;
    }
    if (user.ustatus === UserStatus.BLOCK_TRADE) {
      throw new ForbiddenException(
        'Trading is blocked for your account. Please contact support.',
      );
    }
    return true;
  }
}
