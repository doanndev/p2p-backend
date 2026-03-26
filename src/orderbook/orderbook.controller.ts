import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { OrderbookService } from './orderbook.service';
import { TransactionService } from './transaction.service';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { CreateOrderbookDto } from './dto/create-orderbook.dto';
import { UpdateOrderbookDto } from './dto/update-orderbook.dto';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import {
  QueryMyOrderbooksDto,
  QueryOrderbooksDto,
  QueryTransactionsDto,
} from './dto/query.dto';
import { AttachBankToOrderbookDto } from './dto/attach-bank-to-orderbook.dto';

const ORDERBOOK_CREATE_RESPONSE_EXAMPLE = {
  id: 101,
  user_id: 12,
  coin: 1,
  national: 2,
  adv_code: 'ADV-1711223344556-AB12CD',
  option: 'sell',
  coin_symbol: 'USDT',
  national_symbol: 'VND',
  amount: '100.00000000',
  amount_remaining: '80.00000000',
  price: '25000.00000000',
  national_min: '500000.00000000',
  national_max: '2000000.00000000',
  status: 'pending',
};

const ORDERBOOK_PUBLIC_RESPONSE_EXAMPLE = {
  id: 101,
  user: {
    id: 12,
    username: 'john_doe',
    fullName: 'John Doe',
    avatar: 'https://cdn.example.com/avatar.jpg',
  },
  user_orderbook_stats: {
    total: 12,
    by_status: {
      pending: 3,
      executed: 8,
      failed: 1,
    },
  },
  coin: 1,
  national: 2,
  adv_code: 'ADV-1711223344556-AB12CD',
  option: 'sell',
  coin_symbol: 'USDT',
  national_symbol: 'VND',
  amount: '100.00000000',
  amount_remaining: '80.00000000',
  price: '25000.00000000',
  national_min: '500000.00000000',
  national_max: '2000000.00000000',
  status: 'pending',
  created_at: '2026-03-26T01:23:45.000Z',
};

const TRANSACTION_RESPONSE_EXAMPLE = {
  id: 5001,
  reference_code: 'TX-1711223344556-XY98ZT',
  user_buy: 22,
  user_sell: 12,
  coin: 1,
  national: 2,
  order_book: 101,
  option: 'buy',
  type: 'banking',
  coin_symbol: 'USDT',
  national_symbol: 'VND',
  amount: '20.00000000',
  price: '25000.00000000',
  price_usd: '25000.00000000',
  total_price: '500000.00000000',
  total_usd: '500000.00000000',
  dispute_status: false,
  time_bank: '2026-03-25T08:30:00.000Z',
  status: 'pendding',
  message: null,
};

@ApiTags('Orderbook')
@ApiCookieAuth('access_token')
@Controller('orderbook')
export class OrderbookController {
  constructor(
    private readonly orderbookService: OrderbookService,
    private readonly transactionService: TransactionService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Tạo order book' })
  @ApiBody({ type: CreateOrderbookDto })
  @ApiCreatedResponse({
    description: 'Tạo order book thành công',
    schema: { example: ORDERBOOK_CREATE_RESPONSE_EXAMPLE },
  })
  createOrderBook(@Request() req: any, @Body() dto: CreateOrderbookDto) {
    return this.orderbookService.createOrderBook(req.user.uid, dto);
  }

  @Get()
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  )
  @ApiOperation({
    summary: 'Lấy danh sách order book',
    description:
      'Chỉ trả về orderbook trạng thái pending. Hỗ trợ lọc theo ngày tạo, option, coin, national currency, khoảng amount / amount_remaining, sort theo amount.',
  })
  @ApiOkResponse({
    description: 'Danh sách order book đang pending',
    schema: { example: [ORDERBOOK_PUBLIC_RESPONSE_EXAMPLE] },
  })
  getOrderBooks(@Query() query: QueryOrderbooksDto) {
    return this.orderbookService.getOrderBooks(query);
  }

  /** Đặt trước @Get(':id') để không bị coi id = "my". */
  @Get('my')
  @UseGuards(JwtAuthGuard)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  )
  @ApiOperation({
    summary: 'Lấy danh sách order book của user hiện tại',
    description:
      'Trả về các orderbook do user hiện tại tạo. Hỗ trợ lọc theo status, ngày tạo, option, coin, national currency, khoảng amount / amount_remaining, sort theo amount.',
  })
  @ApiOkResponse({
    description: 'Danh sách order book của tôi',
    schema: { example: [ORDERBOOK_CREATE_RESPONSE_EXAMPLE] },
  })
  getMyOrderBooks(@Request() req: any, @Query() query: QueryMyOrderbooksDto) {
    return this.orderbookService.getMyOrderBooks(req.user.uid, query);
  }

  /** Đặt trước @Get(':id') để không bị coi id = "transactions". */
  @Get('transactions/list')
  @UseGuards(JwtAuthGuard)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  )
  @ApiOperation({
    summary: 'Lấy danh sách transaction theo user hiện tại',
    description:
      'Lọc theo status, ngày tạo, option, coin, national currency, khoảng amount; sort theo amount.',
  })
  @ApiOkResponse({
    description: 'Danh sách transaction',
    schema: { example: [TRANSACTION_RESPONSE_EXAMPLE] },
  })
  getTransactions(@Request() req: any, @Query() query: QueryTransactionsDto) {
    return this.transactionService.getTransactions(req.user.uid, query);
  }

  @Get('transactions/:id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Lấy chi tiết transaction' })
  @ApiOkResponse({
    description: 'Chi tiết transaction',
    schema: { example: TRANSACTION_RESPONSE_EXAMPLE },
  })
  getTransactionDetail(@Request() req: any, @Param('id') id: string) {
    return this.transactionService.getTransactionDetail(
      req.user.uid,
      Number(id),
    );
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Lấy chi tiết order book',
    description:
      'Chỉ trả về khi orderbook còn pending; các trạng thái khác trả 404 (không lộ tồn tại).',
  })
  @ApiOkResponse({
    description: 'Chi tiết order book',
    schema: { example: ORDERBOOK_PUBLIC_RESPONSE_EXAMPLE },
  })
  getOrderBookDetail(@Param('id') id: string) {
    return this.orderbookService.getOrderBookDetail(Number(id));
  }

  @Post(':id/bank-user')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gắn bank user cho orderbook (upsert setting_bank_order)',
  })
  @ApiBody({ type: AttachBankToOrderbookDto })
  @ApiOkResponse({
    description: 'Gắn bank thành công',
    schema: {
      example: {
        message: 'Bank attached to orderbook successfully',
        orderbookId: 101,
        bankUser: {
          id: 1,
          userId: 12,
          bankName: 'Vietcombank',
          bankBranch: 'Hà Nội',
          bankAccountName: 'NGUYEN VAN A',
          bankAccountNumber: '0123456789',
        },
      },
    },
  })
  attachBankToOrderbook(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: AttachBankToOrderbookDto,
  ) {
    return this.orderbookService.attachBankToOrderBook(
      req.user.uid,
      Number(id),
      dto.bankUserId,
    );
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Cập nhật order book' })
  @ApiBody({ type: UpdateOrderbookDto })
  @ApiOkResponse({
    description: 'Cập nhật order book thành công',
    schema: {
      example: {
        ...ORDERBOOK_CREATE_RESPONSE_EXAMPLE,
        price: '25500.00000000',
      },
    },
  })
  updateOrderBook(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateOrderbookDto,
  ) {
    return this.orderbookService.updateOrderBook(req.user.uid, Number(id), dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Soft delete order book và unlock số dư còn lại' })
  @ApiOkResponse({
    description: 'Xóa order book thành công',
    schema: { example: { message: 'Order book deleted successfully' } },
  })
  deleteOrderBook(@Request() req: any, @Param('id') id: string) {
    return this.orderbookService.deleteOrderBook(req.user.uid, Number(id));
  }

  @Post('transactions')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Tạo transaction cho order book' })
  @ApiBody({ type: CreateTransactionDto })
  @ApiCreatedResponse({
    description: 'Tạo transaction thành công',
    schema: { example: TRANSACTION_RESPONSE_EXAMPLE },
  })
  createTransaction(@Request() req: any, @Body() dto: CreateTransactionDto) {
    return this.transactionService.createTransaction(req.user.uid, dto);
  }

  @Post('transactions/:id/confirm-payment')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Xác nhận đã chuyển tiền (pending -> payment_confirmed)',
  })
  @ApiOkResponse({
    description: 'Transaction đã chuyển sang payment_confirmed',
    schema: {
      example: {
        ...TRANSACTION_RESPONSE_EXAMPLE,
        status: 'payment_confirmed',
        time_bank: '2026-03-25T08:45:00.000Z',
      },
    },
  })
  confirmPayment(@Request() req: any, @Param('id') id: string) {
    return this.transactionService.confirmPayment(req.user.uid, Number(id));
  }

  @Post('transactions/:id/confirm-received')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Xác nhận đã nhận tiền (payment_confirmed -> executed) và chuyển lock_balance',
  })
  @ApiOkResponse({
    description: 'Transaction đã executed',
    schema: {
      example: {
        ...TRANSACTION_RESPONSE_EXAMPLE,
        status: 'executed',
      },
    },
  })
  confirmReceived(@Request() req: any, @Param('id') id: string) {
    return this.transactionService.confirmReceived(req.user.uid, Number(id));
  }

  @Post('transactions/:id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Huỷ transaction khi đang pending' })
  @ApiOkResponse({
    description: 'Transaction đã bị huỷ',
    schema: {
      example: {
        ...TRANSACTION_RESPONSE_EXAMPLE,
        status: 'cancelled',
      },
    },
  })
  cancelTransaction(@Request() req: any, @Param('id') id: string) {
    return this.transactionService.cancelTransaction(req.user.uid, Number(id));
  }
}
