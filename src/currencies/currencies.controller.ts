import { Controller, Get, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
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
}
