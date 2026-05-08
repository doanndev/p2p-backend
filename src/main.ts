import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import * as cookieParser from 'cookie-parser';
import { DatabaseExceptionFilter } from './exceptions/database-exception.filter';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import './instrument';
import { SensitiveApiSentryInterceptor } from './common/interceptors/sensitive-api-sentry.interceptor';

async function bootstrap() {
  const nestLoggerLevels =
    process.env.LOG_LEVEL === 'debug'
      ? (['error', 'warn', 'log', 'debug'] as const)
      : (['error', 'warn', 'log'] as const);

  const app = await NestFactory.create(AppModule, {
    logger: [...nestLoggerLevels],
  });
  // Set global prefix cho tất cả routes
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new DatabaseExceptionFilter());

  const configService = app.get(ConfigService);

  // Lấy danh sách các domain từ biến môi trường, nếu không thì mặc định là localhost
  const frontendUrlsRaw =
    configService.get<string>('FRONTEND_URLS') || 'http://localhost:3000';
  const frontendUrls = frontendUrlsRaw.split(',').map((url) => url.trim()); // Tách các URL nếu có nhiều hơn 1 domain

  // Lấy danh sách admin frontend URLs
  const adminFrontendUrlsRaw =
    configService.get<string>('ADMIN_FRONTEND_URLS') || '';
  const adminFrontendUrls = adminFrontendUrlsRaw
    .split(',')
    .map((url) => url.trim())
    .filter((url) => url); // Filter out empty strings

  // Gộp tất cả URLs được phép cho CORS
  const allAllowedUrls = [...frontendUrls, ...adminFrontendUrls];

  const port = 8000;

  // Cấu hình CORS hỗ trợ subdomain
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin) {
        // Cho phép các yêu cầu không có origin (các công cụ test như Postman)
        return callback(null, true);
      }

      const isAllowed = allAllowedUrls.some((url) => {
        const normalizedUrl = url.replace(/\/$/, ''); // Loại bỏ trailing slash
        const regex = new RegExp(
          `^https?://([a-z0-9-]+\\.)?${normalizedUrl
            .replace('http://', '')
            .replace('https://', '')
            .replace(/\./g, '\\.')}(:\\d+)?$`,
        );
        return regex.test(origin);
      });

      if (isAllowed) {
        callback(null, true); // Yêu cầu được phép
      } else {
        callback(new Error('Not allowed by CORS')); // Yêu cầu bị chặn
      }
    },
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    allowedHeaders: 'Content-Type, Accept',
    credentials: true, // Cho phép cookie
  });

  app.use(cookieParser());
  app.useGlobalInterceptors(new SensitiveApiSentryInterceptor());

  const swaggerConfig = new DocumentBuilder()
    .setTitle('Backend 2.5 API')
    .setDescription('API documentation for frontend integration and testing')
    .setVersion('1.0')
    .addCookieAuth('access_token', {
      type: 'apiKey',
      in: 'cookie',
      name: 'access_token',
      description: 'User access token cookie',
    })
    .addCookieAuth('admin_access_token', {
      type: 'apiKey',
      in: 'cookie',
      name: 'admin_access_token',
      description: 'Admin access token cookie',
    })
    .build();

  const swaggerDocument = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, swaggerDocument, {
    swaggerOptions: {
      persistAuthorization: true,
    },
  });

  await app.listen(port, '0.0.0.0');
  console.log(`\uD83D\uDE80 Ứng dụng đang chạy tại: http://0.0.0.0:${port}`);
  console.log(`📚 Swagger docs: http://0.0.0.0:${port}/docs`);
}

bootstrap();
