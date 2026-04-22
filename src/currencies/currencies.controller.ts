import { Controller, Get, HttpCode, HttpStatus, Query } from '@nestjs/common';
import {
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { CurrenciesService } from './currencies.service';

@ApiTags('Currencies')
@Controller('currencies')
export class CurrenciesController {
  constructor(private readonly currenciesService: CurrenciesService) {}

  @Get()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lấy danh sách coin và national currency' })
  @ApiOkResponse({
    description: 'Danh sách coin và national currency đang active',
    schema: {
      example: {
        coins: [{ id: 2, name: 'Tether USD', symbol: 'USDT', logo: '...' }],
        national_currencies: [{ id: 1, name: 'US Dollar', symbol: 'USD' }],
      },
    },
  })
  getCurrencies() {
    return this.currenciesService.getCurrencies();
  }

  @Get('rate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lấy tỉ giá coin/currency từ CoinGecko' })
  @ApiQuery({
    name: 'coin',
    required: true,
    example: 'BTC',
    description: 'Coin symbol (BTC, ETH, SOL, ...) hoặc CoinGecko coin id',
  })
  @ApiQuery({
    name: 'currency',
    required: true,
    example: 'usd',
    description: 'Fiat/quote currency theo chuẩn CoinGecko (usd, vnd, eur...)',
  })
  @ApiOkResponse({
    description: 'Tỉ giá coin theo currency',
    schema: {
      example: {
        coin: 'BTC',
        currency: 'USD',
        rate: 64200.12,
        source: 'coingecko',
        cached: false,
        fetched_at: '2026-04-22T12:00:00.000Z',
      },
    },
  })
  getCoinCurrencyRate(
    @Query('coin') coin: string,
    @Query('currency') currency: string,
  ) {
    return this.currenciesService.getCoinCurrencyRate(coin, currency);
  }
}
