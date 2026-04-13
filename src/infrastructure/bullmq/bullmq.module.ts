import { Global, Module } from '@nestjs/common';
import { BullMqConnectionService } from './bullmq-connection.service';

/** Import once (e.g. in `AppModule`); `BullMqConnectionService` is then injectable everywhere. */
@Global()
@Module({
  providers: [BullMqConnectionService],
  exports: [BullMqConnectionService],
})
export class BullMqModule {}
