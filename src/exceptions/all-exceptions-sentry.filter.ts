import { Catch } from '@nestjs/common';
import { BaseExceptionFilter, HttpAdapterHost } from '@nestjs/core';
import { SentryExceptionCaptured } from '@sentry/nestjs';

@Catch()
export class AllExceptionsSentryFilter extends BaseExceptionFilter {
  constructor(httpAdapterHost: HttpAdapterHost) {
    super(httpAdapterHost.httpAdapter);
  }

  @SentryExceptionCaptured()
  catch(exception: unknown, host: Parameters<BaseExceptionFilter['catch']>[1]) {
    return super.catch(exception, host);
  }
}

