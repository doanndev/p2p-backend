import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

@Injectable()
export class VerifiedUserGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    const user = req?.user;
    if (!user) return false;

    if (user.uverify !== true) {
      throw new ForbiddenException(
        'Identity not verified. Please verify your identity to continue.',
      );
    }
    return true;
  }
}
