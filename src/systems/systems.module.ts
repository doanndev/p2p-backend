import { Module, Global } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { EmailService } from './email.service';
import { CacheService } from './cache.service';
import { DatabaseInitService } from './database-init.service';
import { CloudinaryService } from '../common/services/cloudinary.service';

@Global()
@Module({
  imports: [ConfigModule, TypeOrmModule],
  providers: [
    EmailService,
    CacheService,
    DatabaseInitService,
    CloudinaryService,
  ],
  exports: [EmailService, CacheService, CloudinaryService],
})
export class SystemsModule {}
