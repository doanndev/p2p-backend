import { Global, Module } from '@nestjs/common';
import { RpcRateLimitService } from './rpc-rate-limit.service';
import { SettingsModule } from '../settings/settings.module';

@Global()
@Module({
  imports: [SettingsModule],
  providers: [RpcRateLimitService],
  exports: [RpcRateLimitService],
})
export class RpcRateLimitModule {}
