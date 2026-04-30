import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CurrenciesController } from './currencies.controller';
import { CurrenciesService } from './currencies.service';
import { Coin } from '../settings/entities/coin.entity';
import { NationalCurrency } from '../orderbook/entities/national-currency.entity';

@Module({
  imports: [TypeOrmModule.forFeature([Coin, NationalCurrency])],
  controllers: [CurrenciesController],
  providers: [CurrenciesService],
  exports: [CurrenciesService],
})
export class CurrenciesModule {}
