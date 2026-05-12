import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { SupportChat } from './entities/support-chat.entity';
import { SupportChatMessage } from './entities/support-chat-message.entity';
import { SupportChatService } from './support-chat.service';
import { SupportChatController } from './support-chat.controller';
import { SupportChatGateway } from './support-chat.gateway';
import { User } from '../users/entities/user.entity';
import { Admin } from '../admins/entities/admin.entity';
import { SupportChatHttpAuthGuard } from './guards/support-chat-http-auth.guard';
import { SupportChatAdminGuard } from './guards/support-chat-admin.guard';
import { NotificationsModule } from '../notifications/notifications.module';

@Module({
  imports: [
    NotificationsModule,
    ConfigModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'your-secret-key',
      }),
    }),
    TypeOrmModule.forFeature([SupportChat, SupportChatMessage, User, Admin]),
  ],
  controllers: [SupportChatController],
  providers: [
    SupportChatService,
    SupportChatGateway,
    SupportChatHttpAuthGuard,
    SupportChatAdminGuard,
  ],
  exports: [SupportChatService],
})
export class SupportChatModule {}
