import { Injectable, ExecutionContext } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest();
    const path = request.path || request.url || '';
    
    // Store path in request for use in strategy
    request._emailVerificationBypass = 
      path.includes('/users/generate-code-verify-email') || 
      path.includes('/users/verify-email');
    
    return super.canActivate(context);
  }
}
