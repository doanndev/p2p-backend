import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from './config/database.config';
import { appConfig } from './config/app.config'; // Import file config
import { BlockedUserMiddleware } from './middleware/blocked-user.middleware';
import { User } from './users/entities/user.entity';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { RpcRateLimitModule } from './common/rpc-rate-limit.module';
import { SettingsModule } from './settings/settings.module';
import { WalletsModule } from './wallets/wallets.module';
import { SystemsModule } from './systems/systems.module';
import { UsersModule } from './users/users.module';
import { AdminsModule } from './admins/admins.module';
import { OrderbookModule } from './orderbook/orderbook.module';
import { ChatModule } from './chat/chat.module';
import { SupportChatModule } from './support-chat/support-chat.module';
import { CurrenciesModule } from './currencies/currencies.module';
import { BullMqModule } from './infrastructure/bullmq/bullmq.module';
import { SmartRefModule } from './smart-ref/smart-ref.module';
import { NotificationsModule } from './notifications/notifications.module';
import { SentryModule } from '@sentry/nestjs/setup';
import { APP_FILTER } from '@nestjs/core';
import { AllExceptionsSentryFilter } from './exceptions/all-exceptions-sentry.filter';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    BullMqModule,
    RpcRateLimitModule,
    TypeOrmModule.forFeature([User]),
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'your-secret-key',
        signOptions: {
          expiresIn: '15m',
        },
      }),
      inject: [ConfigService],
    }),
    TypeOrmModule.forRootAsync({
      useFactory: (configService: ConfigService) =>
        databaseConfig(configService),
      inject: [ConfigService],
    }),
    SystemsModule,
    UsersModule,
    SettingsModule,
    WalletsModule,
    AdminsModule,
    OrderbookModule,
    ChatModule,
    SupportChatModule,
    CurrenciesModule,
    SmartRefModule,
    NotificationsModule,
  ],
  controllers: [AppController], // Các controller của ứng dụng
  providers: [
    {
      provide: APP_FILTER,
      useClass: AllExceptionsSentryFilter,
    },
    AppService,
    BlockedUserMiddleware,
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    appConfig(consumer); // Sử dụng cấu hình từ app.config.ts
  }
}
