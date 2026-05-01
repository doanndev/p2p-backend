// app.config.ts
import { MiddlewareConsumer } from '@nestjs/common';
import { LoggerMiddleware } from '../middleware/logger.middleware';
import { OriginValidationMiddleware } from '../middleware/origin-validation.middleware';
// import { AuthMiddleware } from '../middleware/auth.middleware';
import { RateLimiterMiddleware } from '../middleware/rate-limiter.middleware';

export const appConfig = (consumer: MiddlewareConsumer): void => {
  // Áp dụng middleware xác minh origin trước tiên (highest priority)
  consumer.apply(OriginValidationMiddleware).forRoutes('*');

  consumer
    .apply(LoggerMiddleware) // Áp dụng middleware logger cho tất cả các route
    .forRoutes('*');

  // consumer
  //   .apply(AuthMiddleware)  // Áp dụng middleware xác thực cho các route "api/*"
  //   .forRoutes('api/*');  // Chỉ bảo vệ các route "api/*"

  consumer
    .apply(RateLimiterMiddleware) // Áp dụng middleware rate limiter
    .forRoutes('*'); // Áp dụng cho tất cả routes
};
