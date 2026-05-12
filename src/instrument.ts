import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN?.trim() || undefined;

function parseSampleRate(raw: string | undefined, fallback: number): number {
  if (raw === undefined || String(raw).trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(1, Math.max(0, n));
}

const tracesSampleRate = parseSampleRate(
  process.env.SENTRY_TRACES_SAMPLE_RATE,
  0.4,
);

Sentry.init({
  dsn,
  enabled: Boolean(dsn),
  environment:
    process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || 'development',
  /**
   * Performance / Transactions: mỗi request HTTP (được sample) xuất hiện dưới
   * Sentry → Performance (method, route, status, duration, spans DB/outbound…).
   * Đặt SENTRY_TRACES_SAMPLE_RATE=0 để tắt, 1 để gửi 100% (chỉ nên dùng khi dev/test).
   */
  tracesSampleRate,
  sendDefaultPii: process.env.SENTRY_SEND_DEFAULT_PII === 'true',
});
