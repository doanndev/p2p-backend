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
import { VerifiedUserGuard } from '../common/guards/verified-user.guard';
import { CreateOrderbookDto } from './dto/create-orderbook.dto';
import { UpdateOrderbookDto } from './dto/update-orderbook.dto';
import { CreateTransactionDto } from './dto/create-transaction.dto';
import { ConfirmPaymentDto } from './dto/confirm-payment.dto';
import {
  QueryMyOrderbooksDto,
  QueryOrderbooksDto,
  QueryTransactionsDto,
} from './dto/query.dto';
import { AttachBankToOrderbookDto } from './dto/attach-bank-to-orderbook.dto';
import { CreateDisputeDto } from './dto/create-dispute.dto';
import { QueryDisputesDto } from './dto/query-disputes.dto';
import { AdminJwtAuthGuard } from '../admins/guards/admin-jwt-auth.guard';
import { ReviewBankChangeRequestDto } from './dto/review-bank-change-request.dto';

const ORDERBOOK_CREATE_RESPONSE_EXAMPLE = {
  id: 101,
  user: {
    id: 12,
    username: 'john_doe',
    fullName: 'John Doe',
    avatar: 'https://cdn.example.com/avatar.jpg',
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
  description: 'Giao dịch trong giờ hành chính',
};

const ORDERBOOK_PUBLIC_RESPONSE_EXAMPLE = {
  id: 101,
  user: {
    id: 12,
    username: 'john_doe',
    fullName: 'John Doe',
    avatar: 'https://cdn.example.com/avatar.jpg',
    total_transactions: 24,
    successful_transactions: 20,
    failed_transactions: 4,
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
  description: 'Giao dịch trong giờ hành chính',
  created_at: '2026-03-26T01:23:45.000Z',
};

const ORDERBOOK_DETAIL_RESPONSE_EXAMPLE = {
  ...ORDERBOOK_CREATE_RESPONSE_EXAMPLE,
  user: {
    ...ORDERBOOK_CREATE_RESPONSE_EXAMPLE.user,
    total_transactions: 24,
    successful_transactions: 20,
    failed_transactions: 4,
  },
  bank_infor: {
    id: 1,
    userId: 12,
    bankName: 'Vietcombank',
    bankBranch: 'Ha Noi',
    bankAccountName: 'NGUYEN VAN A',
    bankAccountNumber: '0123456789',
  },
};

const ORDERBOOK_MY_RESPONSE_EXAMPLE = {
  ...ORDERBOOK_CREATE_RESPONSE_EXAMPLE,
  created_at: '2026-03-26T01:23:45.000Z',
  bank_infor: {
    id: 1,
    userId: 12,
    bankName: 'Vietcombank',
    bankBranch: 'Ha Noi',
    bankAccountName: 'NGUYEN VAN A',
    bankAccountNumber: '0123456789',
  },
};

const TRANSACTION_RESPONSE_EXAMPLE = {
  id: 5001,
  reference_code: 'TX-1711223344556-XY98ZT',
  user_buy: {
    id: 22,
    username: 'buyer_user',
    fullName: 'Buyer User',
    avatar: 'https://cdn.example.com/avatar-buyer.jpg',
  },
  user_sell: {
    id: 12,
    username: 'seller_user',
    fullName: 'Seller User',
    avatar: 'https://cdn.example.com/avatar-seller.jpg',
  },
  coin: 1,
  national: 2,
  order_book: 101,
  bu_id: 10,
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
  status: 'pending',
  message: null,
  lock_released_at: null,
  expired_at: '2026-03-25T09:00:00.000Z',
  payment_proof_urls: ['https://cdn.example.com/proof/slip-1.jpg'],
};

const DISPUTE_RESPONSE_EXAMPLE = {
  id: 1,
  transaction_id: 5001,
  initiator_id: 22,
  responder_id: 12,
  initiator: {
    id: 22,
    username: 'buyer_user',
    fullName: 'Buyer User',
    avatar: 'https://cdn.example.com/avatar-buyer.jpg',
  },
  responder: {
    id: 12,
    username: 'seller_user',
    fullName: 'Seller User',
    avatar: 'https://cdn.example.com/avatar-seller.jpg',
  },
  transaction: TRANSACTION_RESPONSE_EXAMPLE,
  orderbook: ORDERBOOK_PUBLIC_RESPONSE_EXAMPLE,
  type: 'payment_not_received',
  reason: 'I transferred money but seller has not confirmed.',
  evidence: 'https://cdn.example.com/evidence/payment-slip.png',
  status: 'open',
  admin_id: null,
  resolution: null,
  created_at: '2026-04-10T10:00:00.000Z',
  updated_at: '2026-04-10T10:00:00.000Z',
  resolved_at: null,
};

@ApiTags('Orderbook')
@ApiCookieAuth('access_token')
@ApiCookieAuth('admin_access_token')
@Controller('orderbook')
export class OrderbookController {
  constructor(
    private readonly orderbookService: OrderbookService,
    private readonly transactionService: TransactionService,
  ) {}

  @Post()
  @UseGuards(JwtAuthGuard, VerifiedUserGuard)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
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
      'Chỉ trả về orderbook trạng thái pending. Hỗ trợ lọc theo ngày tạo, option, coin, national currency, khoảng amount (áp vào amount_remaining). Có thể truyền sortPrice/sortAmount để chủ động sắp xếp; nếu không truyền thì sort mặc định: option sell từ thấp lên cao, option buy từ cao xuống thấp.',
  })
  @ApiOkResponse({
    description: 'Danh sách order book đang pending',
    schema: {
      example: {
        statusCode: 200,
        data: [ORDERBOOK_PUBLIC_RESPONSE_EXAMPLE],
        meta: { page: 1, limit: 20, total: 120, total_pages: 6 },
      },
    },
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
    schema: { example: [ORDERBOOK_MY_RESPONSE_EXAMPLE] },
  })
  getMyOrderBooks(@Request() req: any, @Query() query: QueryMyOrderbooksDto) {
    return this.orderbookService.getMyOrderBooks(req.user.uid, query);
  }

  /** Đặt trước @Get(':id') để không bị coi id = "transactions". */
  @Get('transactions/list')
  @UseGuards(JwtAuthGuard, VerifiedUserGuard)
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
      'Lọc theo status, ngày tạo, option, coin, national currency, khoảng amount; sort theo amount. Mỗi item có `expired_at` (ISO 8601 hoặc null) để frontend đếm ngược thời hạn.',
  })
  @ApiOkResponse({
    description: 'Danh sách transaction',
    schema: {
      example: {
        statusCode: 200,
        data: [TRANSACTION_RESPONSE_EXAMPLE],
        meta: { page: 1, limit: 20, total: 45, total_pages: 3 },
      },
    },
  })
  getTransactions(@Request() req: any, @Query() query: QueryTransactionsDto) {
    return this.transactionService.getTransactions(req.user.uid, query);
  }

  @Get('transactions/:id')
  @UseGuards(JwtAuthGuard, VerifiedUserGuard)
  @ApiOperation({
    summary: 'Lấy chi tiết transaction',
    description:
      'Trả về `expired_at` (ISO 8601 hoặc null) — thời điểm hết hạn cho bước hiện tại (pending / payment_confirmed).',
  })
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
    schema: { example: ORDERBOOK_DETAIL_RESPONSE_EXAMPLE },
  })
  getOrderBookDetail(@Param('id') id: string) {
    return this.orderbookService.getOrderBookDetail(Number(id));
  }

  @Post(':id/bank-user')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Tạo yêu cầu đổi bank cho orderbook (chờ admin duyệt)',
  })
  @ApiBody({ type: AttachBankToOrderbookDto })
  @ApiOkResponse({
    description: 'Yêu cầu đổi bank đã được ghi nhận',
    schema: {
      example: {
        message: 'Bank change request submitted and waiting for admin approval',
        orderbookId: 101,
        requestedBankUserId: 1,
        requestedAt: '2026-04-22T10:20:30.000Z',
        expiresInSeconds: 43200,
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

  @Get('admin/bank-user-change-requests')
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({
    summary:
      'Admin lấy danh sách request đổi bank cho orderbook đang chờ duyệt',
  })
  @ApiOkResponse({
    description: 'Danh sách request đang pending',
  })
  getPendingBankChangeRequests() {
    return this.orderbookService.getPendingOrderbookBankChangeRequests();
  }

  @Put('admin/:id/bank-user')
  @UseGuards(AdminJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin duyệt hoặc từ chối request đổi bank cho orderbook',
  })
  @ApiBody({ type: ReviewBankChangeRequestDto })
  @ApiOkResponse({
    description: 'Đã xử lý request đổi bank',
    schema: {
      example: {
        message: 'Orderbook bank change request approved',
        orderbookId: 101,
        approved: true,
      },
    },
  })
  reviewOrderbookBankChangeRequest(
    @Param('id') id: string,
    @Body() dto: ReviewBankChangeRequestDto,
  ) {
    return this.orderbookService.reviewOrderbookBankChangeRequest(
      Number(id),
      dto.approve,
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
  @UseGuards(JwtAuthGuard, VerifiedUserGuard)
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
  @UseGuards(JwtAuthGuard, VerifiedUserGuard)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @ApiOperation({
    summary: 'Xác nhận đã chuyển tiền (pending -> payment_confirmed)',
    description:
      'Buyer gửi danh sách URL ảnh chứng từ; người bán xem qua API chi tiết / list transaction.',
  })
  @ApiBody({ type: ConfirmPaymentDto })
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
  confirmPayment(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: ConfirmPaymentDto,
  ) {
    return this.transactionService.confirmPayment(
      req.user.uid,
      Number(id),
      dto,
    );
  }

  @Post('transactions/:id/confirm-received')
  @UseGuards(JwtAuthGuard, VerifiedUserGuard)
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
  @UseGuards(JwtAuthGuard, VerifiedUserGuard)
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

  @Post('transactions/:id/disputes')
  @UseGuards(JwtAuthGuard, VerifiedUserGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'User tạo dispute cho transaction' })
  @ApiBody({ type: CreateDisputeDto })
  @ApiCreatedResponse({
    description: 'Tạo dispute thành công',
    schema: { example: DISPUTE_RESPONSE_EXAMPLE },
  })
  createDispute(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: CreateDisputeDto,
  ) {
    return this.transactionService.createDispute(req.user.uid, Number(id), dto);
  }

  @Get('disputes')
  @UseGuards(JwtAuthGuard, VerifiedUserGuard)
  @ApiOperation({ summary: 'User lấy danh sách dispute do mình tạo' })
  @ApiOkResponse({
    description: 'Danh sách dispute',
    schema: { example: [DISPUTE_RESPONSE_EXAMPLE] },
  })
  getMyDisputes(@Request() req: any) {
    return this.transactionService.getMyDisputes(req.user.uid);
  }

  @Get('disputes/:id')
  @UseGuards(JwtAuthGuard, VerifiedUserGuard)
  @ApiOperation({ summary: 'User lấy chi tiết dispute do mình tạo' })
  @ApiOkResponse({
    description: 'Chi tiết dispute',
    schema: { example: DISPUTE_RESPONSE_EXAMPLE },
  })
  getMyDisputeDetail(@Request() req: any, @Param('id') id: string) {
    return this.transactionService.getMyDisputeDetail(req.user.uid, Number(id));
  }

  @Get('admin/disputes')
  @UseGuards(AdminJwtAuthGuard)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: false,
    }),
  )
  @ApiOperation({ summary: 'Admin lấy danh sách dispute toàn hệ thống' })
  @ApiOkResponse({
    description: 'Danh sách dispute toàn hệ thống',
    schema: { example: [DISPUTE_RESPONSE_EXAMPLE] },
  })
  adminGetDisputes(@Request() req: any, @Query() query: QueryDisputesDto) {
    return this.transactionService.adminGetDisputes(req.user.admin_id, query);
  }

  @Get('admin/disputes/:id')
  @UseGuards(AdminJwtAuthGuard)
  @ApiOperation({ summary: 'Admin lấy chi tiết dispute' })
  @ApiOkResponse({
    description: 'Chi tiết dispute',
    schema: { example: DISPUTE_RESPONSE_EXAMPLE },
  })
  adminGetDisputeDetail(@Request() req: any, @Param('id') id: string) {
    return this.transactionService.adminGetDisputeDetail(
      req.user.admin_id,
      Number(id),
    );
  }
}
