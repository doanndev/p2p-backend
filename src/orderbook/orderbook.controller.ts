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
} from '@nestjs/common';
import {
  ApiBody,
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
import { QueryTransactionsDto } from './dto/query-transactions.dto';

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
  async createOrderBook(@Request() req: any, @Body() dto: CreateOrderbookDto) {
    const data = await this.orderbookService.createOrderBook(req.user.uid, dto);
    return {
      statusCode: HttpStatus.CREATED,
      message: 'Create order book successfully',
      data,
    };
  }

  @Get()
  @ApiOperation({ summary: 'Lấy danh sách order book' })
  async getOrderBooks() {
    const data = await this.orderbookService.getOrderBooks();
    return {
      statusCode: HttpStatus.OK,
      message: 'Get order books successfully',
      data,
    };
  }

  @Get(':id')
  @ApiOperation({ summary: 'Lấy chi tiết order book' })
  async getOrderBookDetail(@Param('id') id: string) {
    const data = await this.orderbookService.getOrderBookDetail(Number(id));
    return {
      statusCode: HttpStatus.OK,
      message: 'Get order book detail successfully',
      data,
    };
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Cập nhật order book' })
  @ApiBody({ type: UpdateOrderbookDto })
  async updateOrderBook(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateOrderbookDto,
  ) {
    const data = await this.orderbookService.updateOrderBook(
      req.user.uid,
      Number(id),
      dto,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Update order book successfully',
      data,
    };
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Soft delete order book và unlock số dư còn lại' })
  async deleteOrderBook(@Request() req: any, @Param('id') id: string) {
    const data = await this.orderbookService.deleteOrderBook(
      req.user.uid,
      Number(id),
    );
    return {
      statusCode: HttpStatus.OK,
      message: data.message,
    };
  }

  @Post('transactions')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Tạo transaction cho order book' })
  @ApiBody({ type: CreateTransactionDto })
  async createTransaction(
    @Request() req: any,
    @Body() dto: CreateTransactionDto,
  ) {
    const data = await this.transactionService.createTransaction(
      req.user.uid,
      dto,
    );
    return {
      statusCode: HttpStatus.CREATED,
      message: 'Create transaction successfully',
      data,
    };
  }

  @Get('transactions/list')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Lấy danh sách transaction theo user hiện tại' })
  @ApiOkResponse({ description: 'Có thể filter theo status' })
  async getTransactions(
    @Request() req: any,
    @Query() query: QueryTransactionsDto,
  ) {
    const data = await this.transactionService.getTransactions(
      req.user.uid,
      query.status,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Get transactions successfully',
      data,
    };
  }

  @Get('transactions/:id')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Lấy chi tiết transaction' })
  async getTransactionDetail(@Request() req: any, @Param('id') id: string) {
    const data = await this.transactionService.getTransactionDetail(
      req.user.uid,
      Number(id),
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Get transaction detail successfully',
      data,
    };
  }

  @Post('transactions/:id/confirm-payment')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary: 'Xác nhận đã chuyển tiền (pending -> payment_confirmed)',
  })
  async confirmPayment(@Request() req: any, @Param('id') id: string) {
    const data = await this.transactionService.confirmPayment(
      req.user.uid,
      Number(id),
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Confirm payment successfully',
      data,
    };
  }

  @Post('transactions/:id/confirm-received')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({
    summary:
      'Xác nhận đã nhận tiền (payment_confirmed -> executed) và chuyển lock_balance',
  })
  async confirmReceived(@Request() req: any, @Param('id') id: string) {
    const data = await this.transactionService.confirmReceived(
      req.user.uid,
      Number(id),
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Confirm received successfully',
      data,
    };
  }

  @Post('transactions/:id/cancel')
  @UseGuards(JwtAuthGuard)
  @ApiOperation({ summary: 'Huỷ transaction khi đang pending' })
  async cancelTransaction(@Request() req: any, @Param('id') id: string) {
    const data = await this.transactionService.cancelTransaction(
      req.user.uid,
      Number(id),
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Cancel transaction successfully',
      data,
    };
  }
}
