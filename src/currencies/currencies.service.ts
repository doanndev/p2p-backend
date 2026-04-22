import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import axios from 'axios';
import { Repository } from 'typeorm';
import { Coin, CoinStatus } from '../settings/entities/coin.entity';
import {
  NationalCurrency,
  NationalCurrencyStatus,
} from '../orderbook/entities/national-currency.entity';
import { CacheService } from '../systems/cache.service';

const COINGECKO_RATE_CACHE_TTL_SECONDS = 30 * 60;
const COINGECKO_SYMBOL_TO_ID: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  BNB: 'binancecoin',
  TRX: 'tron',
  ARB: 'arbitrum',
  USDT: 'tether',
  USDC: 'usd-coin',
};

@Injectable()
export class CurrenciesService {
  constructor(
    @InjectRepository(Coin)
    private readonly coinRepository: Repository<Coin>,
    @InjectRepository(NationalCurrency)
    private readonly nationalCurrencyRepository: Repository<NationalCurrency>,
    private readonly cacheService: CacheService,
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

  async getCoinCurrencyRate(coin: string, currency: string) {
    const normalizedCoin = coin?.trim().toUpperCase();
    const normalizedCurrency = currency?.trim().toLowerCase();

    if (!normalizedCoin || !normalizedCurrency) {
      throw new BadRequestException('coin and currency are required');
    }

    const coingeckoId =
      COINGECKO_SYMBOL_TO_ID[normalizedCoin] ?? normalizedCoin.toLowerCase();
    const cacheKey = `coingecko:rate:${coingeckoId}:${normalizedCurrency}`;

    const cached = await this.cacheService.get(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as {
          coin: string;
          currency: string;
          rate: number;
          source: string;
          cached: boolean;
          fetched_at: string;
        };
        return { ...parsed, cached: true };
      } catch {
        // ignore parse error and refetch
      }
    }

    const { data } = await axios.get<Record<string, Record<string, number>>>(
      'https://api.coingecko.com/api/v3/simple/price',
      {
        params: { ids: coingeckoId, vs_currencies: normalizedCurrency },
        timeout: 15000,
      },
    );

    const rate = data?.[coingeckoId]?.[normalizedCurrency];
    if (typeof rate !== 'number' || Number.isNaN(rate)) {
      throw new BadRequestException(
        `Unable to get rate for coin=${coin} and currency=${currency}`,
      );
    }

    const payload = {
      coin: normalizedCoin,
      currency: normalizedCurrency.toUpperCase(),
      rate,
      source: 'coingecko',
      cached: false,
      fetched_at: new Date().toISOString(),
    };
    await this.cacheService.set(
      cacheKey,
      JSON.stringify(payload),
      COINGECKO_RATE_CACHE_TTL_SECONDS,
    );

    return payload;
  }
}
