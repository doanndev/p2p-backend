import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Observable, throwError } from 'rxjs';
import { catchError, tap } from 'rxjs/operators';
import * as Sentry from '@sentry/nestjs';

@Injectable()
export class SensitiveApiSentryInterceptor implements NestInterceptor {
  private static readonly SENSITIVE_PATH_PATTERNS = [
    /\/orderbook(\/|$)/i,
    /\/bank-users?(\/|$)/i,
    /\/transactions?(\/|$)/i,
  ];

  intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
    if (context.getType() !== 'http') {
      return next.handle();
    }

    const req = context.switchToHttp().getRequest();
    const method = req?.method ?? 'UNKNOWN';
    const rawUrl = req?.originalUrl ?? req?.url ?? '';
    const path = String(rawUrl).split('?')[0];

    if (!this.isSensitivePath(path)) {
      return next.handle();
    }

    const startedAt = Date.now();
    const requestId =
      (req?.headers?.['x-request-id'] as string | undefined) ?? undefined;

    return next.handle().pipe(
      tap(() => undefined),
      catchError((error) => {
        Sentry.withScope((scope) => {
          scope.setTag('api.sensitive', 'true');
          scope.setTag('api.path', path);
          scope.setTag('api.method', method);
          if (requestId) {
            scope.setTag('request.id', requestId);
          }
          scope.setContext('request', {
            method,
            path,
            ip: req?.ip,
            userAgent: req?.headers?.['user-agent'],
          });
          Sentry.captureException(error);
        });

        (Sentry as any).logger?.error?.('Sensitive API failed', {
          method,
          path,
          requestId,
          durationMs: Date.now() - startedAt,
          message: error?.message,
        });

        return throwError(() => error);
      }),
    );
  }

  private isSensitivePath(path: string): boolean {
    return SensitiveApiSentryInterceptor.SENSITIVE_PATH_PATTERNS.some(
      (pattern) => pattern.test(path),
    );
  }
}
