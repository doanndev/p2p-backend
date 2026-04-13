import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { databaseConfig } from './config/database.config';
import { appConfig } from './config/app.config'; // Import file config
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

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    BullMqModule,
    RpcRateLimitModule,
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
  ],
  controllers: [AppController], // Các controller của ứng dụng
  providers: [AppService],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    appConfig(consumer); // Sử dụng cấu hình từ app.config.ts
  }
}
