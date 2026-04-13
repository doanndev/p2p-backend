import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { UsersController } from './users.controller';
import { UsersService } from './users.service';
import { GoogleAuthService } from './google-auth.service';
import { StorageService } from './storage.service';
import { User } from './entities/user.entity';
import { UserCode } from './entities/user-code.entity';
import { UserVerify } from './entities/user-verify.entity';
import { VerifyLog } from './entities/verify-log.entity';
import { KolRegister } from './entities/kol-register.entity';
import { KolArticle } from './entities/kol-article.entity';
import { Notification } from './entities/notification.entity';
import { UserLog } from './entities/user-log.entity';
import { BankUser } from './entities/bank-user.entity';
import { UserWallet } from '../wallets/entities/user-wallet.entity';
import { Coin } from '../settings/entities/coin.entity';
import { JwtStrategy } from '../common/strategies/jwt.strategy';
import { SystemsModule } from '../systems/systems.module';
import { BankUsersController } from './bank-users.controller';
import { BankUsersService } from './bank-users.service';
import { SettingBankOrder } from '../orderbook/entities/setting-bank-order.entity';
import { UserSecurityController } from './user-security.controller';
import { UserSecurityService } from './user-security.service';
import { UserLevelUpWorker } from './user-level-up.worker';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      User,
      UserCode,
      UserVerify,
      VerifyLog,
      KolRegister,
      KolArticle,
      Notification,
      UserLog,
      BankUser,
      UserWallet,
      Coin,
      SettingBankOrder,
    ]),
    PassportModule,
    ConfigModule,
    SystemsModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: async (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET') || 'your-secret-key',
        signOptions: {
          expiresIn: '15m', // access_token expires in 15 minutes
        },
      }),
      inject: [ConfigService],
    }),
  ],
  controllers: [UsersController, BankUsersController, UserSecurityController],
  providers: [
    UsersService,
    GoogleAuthService,
    StorageService,
    JwtStrategy,
    BankUsersService,
    UserSecurityService,
    UserLevelUpWorker,
  ],
  exports: [UsersService, UserLevelUpWorker],
})
export class UsersModule {}
