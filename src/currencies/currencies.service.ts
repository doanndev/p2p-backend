import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Coin, CoinStatus } from '../settings/entities/coin.entity';
import {
  NationalCurrency,
  NationalCurrencyStatus,
} from '../orderbook/entities/national-currency.entity';

@Injectable()
export class CurrenciesService {
  constructor(
    @InjectRepository(Coin)
    private readonly coinRepository: Repository<Coin>,
    @InjectRepository(NationalCurrency)
    private readonly nationalCurrencyRepository: Repository<NationalCurrency>,
  ) {}

  async getCurrencies() {
    const [coins, nationalCurrencies] = await Promise.all([
      this.coinRepository.find({
        where: { coin_status: CoinStatus.ACTIVE },
        order: { coin_id: 'ASC' },
      }),
      this.nationalCurrencyRepository.find({
        where: { nc_status: NationalCurrencyStatus.ACTIVE },
        order: { nc_id: 'ASC' },
      }),
    ]);

    return {
      coins: coins.map((coin) => ({
        id: coin.coin_id,
        name: coin.coin_name,
        symbol: coin.coin_symbol,
        logo: coin.coin_logo,
      })),
      national_currencies: nationalCurrencies.map((currency) => ({
        id: currency.nc_id,
        name: currency.nc_name,
        symbol: currency.nc_symbol,
        logo: currency.nc_logo,
      })),
    };
  }
}
