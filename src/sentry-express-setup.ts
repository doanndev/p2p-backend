import type { INestApplication } from '@nestjs/common';
import type { Request, Response, NextFunction } from 'express';
import * as Sentry from '@sentry/nestjs';

const MAX_PATH_TAG_LEN = 200;

/**
 * Thay thế cho `Sentry.Handlers.requestHandler()` (SDK 7.x / @sentry/node cũ).
 *
 * Trên `@sentry/nestjs` v10, request được gắn trace/context qua HTTP + Express instrumentation
 * (`instrument.ts` phải import trước). Hàm này bổ sung breadcrumb + tag trên isolation scope
 * cho mỗi request inbound (đầu mối debug trong Issues/Logs). Lỗi Express dùng
 * `applySentryExpressErrorHandler` (gọi trước `listen`).
 */
export function applySentryExpressInboundMiddleware(
  app: INestApplication,
): void {
  if (!Sentry.isEnabled()) return;

  const adapter = app.getHttpAdapter();
  const getInstance = (adapter as { getInstance?: () => unknown }).getInstance;
  if (typeof getInstance !== 'function') return;
  const expressApp = getInstance.call(adapter) as {
    use?: (fn: unknown) => void;
  };
  if (typeof expressApp?.use !== 'function') return;

  app.use((req: Request, _res: Response, next: NextFunction) => {
    const path = req.originalUrl ?? req.url ?? '';
    const method = req.method ?? 'GET';

    Sentry.getIsolationScope().setTags({
      http_method: method,
      http_path:
        path.length > MAX_PATH_TAG_LEN ? path.slice(0, MAX_PATH_TAG_LEN) : path,
    });

    Sentry.addBreadcrumb({
      category: 'http',
      type: 'http',
      data: {
        method,
        url: path,
      },
      level: 'info',
    });

    next();
  });
}

/** Gọi sau khi đã gắn route/middleware (trước `listen`). */
export function applySentryExpressErrorHandler(app: INestApplication): void {
  if (!Sentry.isEnabled()) return;

  const adapter = app.getHttpAdapter();
  const getInstance = (adapter as { getInstance?: () => unknown }).getInstance;
  if (typeof getInstance !== 'function') return;
  const expressApp = getInstance.call(adapter);
  if (!expressApp || typeof expressApp !== 'object') return;

  Sentry.setupExpressErrorHandler(
    expressApp as { use: (fn: unknown) => unknown },
  );
}
