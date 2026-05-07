import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN;

Sentry.init({
  dsn,
  // enabled: Boolean(dsn),
  // environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV,
  // tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0.1),
  sendDefaultPii: process.env.SENTRY_SEND_DEFAULT_PII === 'true',
  // enableLogs: process.env.SENTRY_ENABLE_LOGS !== 'false',
});
