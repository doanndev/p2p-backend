import { Catch, HttpException } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { SentryExceptionCaptured } from '@sentry/nestjs';
import * as Sentry from '@sentry/nestjs';

@Catch()
export class AllExceptionsSentryFilter extends BaseExceptionFilter {
  constructor(httpAdapterHost: HttpAdapterHost) {
    super(httpAdapterHost.httpAdapter);
  }

  @SentryExceptionCaptured()
  catch(exception: unknown, host: Parameters<BaseExceptionFilter['catch']>[1]) {
    Sentry.withScope((scope) => {
      if (exception instanceof HttpException) {
        scope.setTag('http_exception', 'true');
        scope.setContext('http', {
          statusCode: exception.getStatus(),
          response: exception.getResponse(),
        });
      }
      Sentry.captureException(exception);
    });

    return super.catch(exception, host);
  }
}
