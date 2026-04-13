import {
  Controller,
  Get,
  Post,
  Body,
  Query,
  HttpCode,
  HttpStatus,
  Request,
  UseGuards,
  UsePipes,
  ValidationPipe,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { InternalExchangeDto } from './dto/internal-exchange.dto';
import { RequestInternalExchangeVerifyCodeDto } from './dto/request-internal-exchange-verify-code.dto';
import { TransferRewardDto } from './dto/transfer-reward.dto';
import { TransactionHistoryDto } from './dto/transaction-history.dto';
import { TransferRewardsHistoryDto } from './dto/transfer-rewards-history.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
  ApiBadRequestResponse,
  ApiBody,
  ApiCreatedResponse,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('Wallets')
@ApiCookieAuth('access_token')
@Controller('wallets')
export class WalletsController {
  constructor(private readonly walletsService: WalletsService) {}

  @Get('list-coins')
  @ApiOperation({ summary: 'Lấy danh sách coin hệ thống' })
  @ApiOkResponse({
    description: 'Danh sách coin',
    schema: {
      example: {
        statusCode: 200,
        message: 'Get list coins successfully',
        data: [{ id: 1, symbol: 'USDT', name: 'Tether USD' }],
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  async getListCoins() {
    const coins = await this.walletsService.getListCoins();
    return {
      statusCode: HttpStatus.OK,
      message: 'Get list coins successfully',
      data: coins,
    };
  }

  @Get('list-networks')
  @ApiOperation({ summary: 'Lấy danh sách network hệ thống' })
  @ApiOkResponse({
    description: 'Danh sách network',
    schema: {
      example: {
        statusCode: 200,
        message: 'Get list networks successfully',
        data: [{ id: 1, symbol: 'BSC', name: 'Binance Smart Chain' }],
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  async getListNetworks() {
    const networks = await this.walletsService.getListNetworks();
    return {
      statusCode: HttpStatus.OK,
      message: 'Get list networks successfully',
      data: networks,
    };
  }

  @Get('token-prices-usdt')
  @ApiOperation({
    summary:
      'Giá token quy đổi USDT (cache ~60s, CoinGecko / fallback Binance)',
  })
  @ApiOkResponse({
    description: 'Map symbol → giá USDT gần đúng + timestamp',
    schema: {
      example: {
        statusCode: 200,
        message: 'OK',
        data: { BTC: 95000, ETH: 3500, USDT: 1, timestamp: 1710000000000 },
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  async getTokenPricesUsdt() {
    const data = await this.walletsService.getTokenPricesUsdt();
    return {
      statusCode: HttpStatus.OK,
      message: 'Get token prices (USDT) successfully',
      data,
    };
  }

  @Get('network')
  @ApiOperation({ summary: 'Lấy ví của user theo network id' })
  @ApiQuery({ name: 'id', required: true, example: '1' })
  @ApiOkResponse({
    description: 'Thông tin ví theo network',
    schema: {
      example: {
        statusCode: 200,
        message: 'Get wallet successfully',
        data: {
          id: 87,
          network_id: 1,
          public_key: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
          qr_code: 'data:image/png;base64,iVBORw0KGgoAAA...',
        },
      },
    },
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getWalletByNetwork(
    @Query('id') networkId: string,
    @Request() req: any,
  ) {
    const user = req.user; // User from JWT token

    if (!networkId || isNaN(Number(networkId))) {
      throw new BadRequestException(
        'Network ID is required and must be a number',
      );
    }

    const wallet = await this.walletsService.getWalletByNetwork(
      user.uid,
      Number(networkId),
    );

    if (!wallet) {
      throw new NotFoundException('Wallet not found for this network');
    }

    // Generate QR code from public key
    const qrCode = await this.walletsService.generateQRCode(
      wallet.uwn_public_key,
    );

    // Transform response: bỏ uwn_user_id, created_at, updated_at và bỏ tiền tố uwn_
    const transformedWallet = {
      id: wallet.uwn_id,
      network_id: wallet.uwn_network_id,
      public_key: wallet.uwn_public_key,
      qr_code: qrCode,
    };

    return {
      statusCode: HttpStatus.OK,
      message: 'Get wallet successfully',
      data: transformedWallet,
    };
  }

  @Get('balance')
  @ApiOperation({ summary: 'Lấy số dư theo coin của user' })
  @ApiQuery({ name: 'coin_id', required: true, example: '1' })
  @ApiOkResponse({
    description: 'Thông tin số dư',
    schema: {
      example: {
        statusCode: 200,
        message: 'Get balance successfully',
        data: {
          id: 22,
          wallet_type: 'main',
          coin_id: 1,
          balance: 520.75,
          lock_balance: 120,
          balance_gift: 10,
          balance_reward: 3.15,
        },
      },
    },
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getBalance(@Query('coin_id') coinId: string, @Request() req: any) {
    const user = req.user; // User from JWT token

    if (!coinId || isNaN(Number(coinId))) {
      throw new BadRequestException('Coin ID is required and must be a number');
    }

    const wallet = await this.walletsService.getBalanceByCoin(
      user.uid,
      Number(coinId),
    );

    if (!wallet) {
      throw new NotFoundException('Balance not found for this coin');
    }

    // Transform response: bỏ tiền tố uw_ và các trường không cần thiết
    const transformedBalance = {
      id: wallet.uw_id,
      wallet_type: wallet.uw_wallet_type,
      coin_id: wallet.uw_wallet_coins,
      balance: parseFloat(wallet.uw_balance.toString()),
      lock_balance: parseFloat(wallet.uw_lock_balance.toString()),
      balance_gift: parseFloat(wallet.uw_balance_gift.toString()),
      balance_reward: parseFloat(wallet.uw_balance_reward.toString()),
    };

    return {
      statusCode: HttpStatus.OK,
      message: 'Get balance successfully',
      data: transformedBalance,
    };
  }

  @Post('create-wallet')
  @ApiOperation({ summary: 'Tạo ví mới theo network' })
  @ApiBody({ type: CreateWalletDto })
  @ApiCreatedResponse({
    description: 'Tạo ví thành công',
    schema: {
      example: {
        statusCode: 201,
        message: 'Create wallet successfully',
        data: {
          id: 91,
          network_id: 1,
          public_key: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
        },
      },
    },
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async createWallet(
    @Body() createWalletDto: CreateWalletDto,
    @Request() req: any,
  ) {
    const user = req.user; // User from JWT token
    const result = await this.walletsService.createWallet(
      user.uid,
      createWalletDto.networkId,
    );
    return {
      statusCode: HttpStatus.CREATED,
      message: result.message,
      data: result.wallet,
    };
  }

  @Get('my-wallet')
  @ApiOperation({ summary: 'Lấy toàn bộ ví của user hiện tại' })
  @ApiOkResponse({
    description: 'Danh sách ví của user',
    schema: {
      example: {
        statusCode: 200,
        message: 'Get my wallets successfully',
        data: [
          {
            id: 91,
            network_id: 1,
            public_key: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
          },
        ],
      },
    },
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getMyWallet(@Request() req: any) {
    const user = req.user; // User from JWT token
    const wallets = await this.walletsService.getMyWallets(user.uid);
    return {
      statusCode: HttpStatus.OK,
      message: 'Get my wallets successfully',
      data: wallets,
    };
  }

  @Get('check-wallet-network')
  @ApiOperation({ summary: 'Kiểm tra địa chỉ ví theo network symbol' })
  @ApiQuery({ name: 'network', required: true, example: 'BSC' })
  @ApiOkResponse({
    description: 'Địa chỉ ví theo network',
    schema: {
      example: {
        statusCode: 200,
        message: 'Check wallet network successfully',
        data: {
          address: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
          qr_code: 'data:image/png;base64,iVBORw0KGgoAAA...',
        },
      },
    },
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async checkWalletNetwork(
    @Query('network') network: string,
    @Request() req: any,
  ) {
    const user = req.user; // User from JWT token

    if (!network) {
      throw new BadRequestException('Network parameter is required');
    }

    const address = await this.walletsService.checkWalletNetwork(
      user.uid,
      network,
    );

    // Generate QR code from address if exists
    let qrCode: string | null = null;
    if (address) {
      qrCode = await this.walletsService.generateQRCode(address);
    }

    return {
      statusCode: HttpStatus.OK,
      message: 'Check wallet network successfully',
      data: {
        address: address,
        qr_code: qrCode,
      },
    };
  }

  @Post('transfer-reward')
  @ApiOperation({
    summary: 'Chuyển số dư reward sang ví chính',
    description:
      'Gửi `Content-Type: application/json`. User **chưa bật 2FA**: body `{}` hoặc bỏ qua field. ' +
      'User **đã bật 2FA**: bắt buộc `twoFactorCode` (6 chữ số từ Google Authenticator).',
  })
  @ApiBody({
    type: TransferRewardDto,
    examples: {
      khong2FA: {
        summary: 'Không bật 2FA',
        value: {},
      },
      co2FA: {
        summary: 'Đã bật 2FA',
        value: { twoFactorCode: '123456' },
      },
    },
  })
  @ApiOkResponse({
    description:
      'Chuyển reward thành công. **data.new_balance_reward**: số reward vừa gộp (sau xử lý thường 0). **data.updated_coins**: danh sách coin_id đã cập nhật.',
    schema: {
      example: {
        statusCode: 200,
        message: 'Reward transferred to main balance successfully',
        data: {
          new_balance_reward: 12.5,
          updated_coins: [1, 2, 3],
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'Thiếu/sai mã 2FA (khi đã bật), hoặc lỗi nghiệp vụ (reward ≤ 0, không có ví, …)',
    schema: {
      oneOf: [
        {
          example: {
            statusCode: 400,
            message:
              'Two-factor authentication code is required for this action',
            error: 'Bad Request',
          },
        },
        {
          example: {
            statusCode: 400,
            message: 'Invalid two-factor authentication code',
            error: 'Bad Request',
          },
        },
        {
          example: {
            statusCode: 400,
            message:
              'Cannot transfer reward: calculated balance is 0 (must be > 0)',
            error: 'Bad Request',
          },
        },
      ],
    },
  })
  @UseGuards(JwtAuthGuard)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @HttpCode(HttpStatus.OK)
  async transferReward(@Body() body: TransferRewardDto, @Request() req: any) {
    const user = req.user; // User from JWT token
    const result = await this.walletsService.transferReward(
      user.uid,
      body.twoFactorCode,
    );
    return {
      statusCode: HttpStatus.OK,
      message: result.message,
      data: {
        new_balance_reward: result.newBalanceReward,
        updated_coins: result.updatedCoins,
      },
    };
  }

  @Get('transfer-rewards')
  @ApiOperation({ summary: 'Lịch sử chuyển reward' })
  @ApiOkResponse({
    description: 'Lịch sử chuyển reward',
    schema: {
      example: {
        statusCode: 200,
        message: 'Get transfer rewards history successfully',
        data: [
          {
            id: 17,
            from: 'reward',
            to: 'main',
            amount: 8.25,
            status: 'success',
          },
        ],
      },
    },
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getTransferRewardsHistory(
    @Query() query: TransferRewardsHistoryDto,
    @Request() req: any,
  ) {
    const user = req.user; // User from JWT token
    const transfers = await this.walletsService.getTransferRewardsHistory(
      user.uid,
      query.status,
    );

    // Format response để bỏ tiền tố wt_ và format dữ liệu
    const formattedTransfers = transfers.map((transfer) => ({
      id: transfer.wt_id,
      user_id: transfer.wt_user_id,
      from: transfer.wt_from,
      to: transfer.wt_to,
      amount: parseFloat(transfer.wt_amount.toString()),
      status: transfer.wt_status,
      created_at: transfer.created_at,
      updated_at: transfer.updated_at,
    }));

    return {
      statusCode: HttpStatus.OK,
      message: 'Get transfer rewards history successfully',
      data: formattedTransfers,
    };
  }

  @Post('withdraw')
  @ApiOperation({
    summary: 'Rút coin về ví ngoài',
    description:
      '**twoFactorCode**: bắt buộc khi user đã bật 2FA (`GET /users/security/2fa/status` → enabled=true). ' +
      'Địa chỉ và mạng phải khớp quy tắc từng chain (EVM / Solana).',
  })
  @ApiBody({
    type: WithdrawDto,
    examples: {
      khong2FA: {
        summary: 'Chưa bật 2FA',
        value: {
          networkId: 1,
          coinId: 2,
          address: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
          amount: 10.5,
        },
      },
      co2FA: {
        summary: 'Đã bật 2FA',
        value: {
          networkId: 1,
          coinId: 2,
          address: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
          amount: 10.5,
          twoFactorCode: '123456',
        },
      },
    },
  })
  @ApiOkResponse({
    description:
      'Rút thành công. **transaction_hash**: hash on-chain. **history_id**: id bản ghi lịch sử ví.',
    schema: {
      example: {
        statusCode: 200,
        message: 'Withdraw successfully',
        data: {
          transaction_hash:
            '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW',
          history_id: 201,
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'Thiếu/sai mã 2FA (khi đã bật), KYC, số dư, địa chỉ, RPC/overload, …',
    schema: {
      oneOf: [
        {
          example: {
            statusCode: 400,
            message:
              'Two-factor authentication code is required for this action',
            error: 'Bad Request',
          },
        },
        {
          example: {
            statusCode: 400,
            message: 'Invalid two-factor authentication code',
            error: 'Bad Request',
          },
        },
        {
          example: {
            statusCode: 400,
            message:
              'The system is overloaded. Please try again later or try a different network.',
            error: 'Bad Request',
          },
        },
      ],
    },
  })
  @UseGuards(JwtAuthGuard)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @HttpCode(HttpStatus.OK)
  async withdraw(@Body() withdrawDto: WithdrawDto, @Request() req: any) {
    const user = req.user; // User from JWT token
    const result = await this.walletsService.withdraw(
      user.uid,
      withdrawDto.networkId,
      withdrawDto.coinId,
      withdrawDto.address,
      withdrawDto.amount,
      withdrawDto.twoFactorCode,
    );
    return {
      statusCode: HttpStatus.OK,
      message: result.message,
      data: {
        transaction_hash: result.transaction_hash,
        history_id: result.history_id,
      },
    };
  }

  @Post('exchange/internal/verify-code')
  @ApiOperation({
    summary: 'Gửi mã email xác nhận chuyển nội bộ',
    description:
      'Gửi mã 6 ký tự tới email đăng ký (template Verify Email Code, bảng `user_codes`, loại `internal-exchange`). ' +
      'Dùng mã trong `POST /wallets/exchange/internal` (field `emailCode`).',
  })
  @ApiBody({ type: RequestInternalExchangeVerifyCodeDto, required: false })
  @ApiOkResponse({
    description: 'Đã gửi email',
    schema: {
      example: {
        statusCode: 200,
        message: 'Verification code has been sent to your email',
        data: { expires_at: '2026-04-13T12:03:00.000Z' },
      },
    },
  })
  @UseGuards(JwtAuthGuard)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @HttpCode(HttpStatus.OK)
  async requestInternalExchangeVerifyCode(@Request() req: any) {
    const result = await this.walletsService.sendInternalExchangeVerifyCode(
      req.user.uid,
    );
    return {
      statusCode: HttpStatus.OK,
      message: result.message,
      data: { expires_at: result.expires_at },
    };
  }

  @Post('exchange/internal')
  @ApiOperation({
    summary: 'Chuyển coin nội bộ sàn (exchange)',
    description:
      'Trừ số dư người gửi và cộng cho người nhận trong một giao dịch DB (ACID). ' +
      'Bắt buộc `emailCode` (lấy qua `POST /wallets/exchange/internal/verify-code`). ' +
      'Kiểm tra KYC, 2FA, số dư, phí rút (1 đơn vị coin khi hết lượt free), max withdraw giống `POST /wallets/withdraw`.',
  })
  @ApiBody({
    type: InternalExchangeDto,
    examples: {
      example: {
        summary: 'Chuyển USDT nội bộ',
        value: {
          recipientUserId: 42,
          coinId: 2,
          amount: 10.5,
          emailCode: 'A1B2C3',
          twoFactorCode: '123456',
        },
      },
    },
  })
  @ApiOkResponse({
    description: 'Chuyển thành công',
    schema: {
      example: {
        statusCode: 200,
        message: 'Internal transfer successful',
        data: {
          sender_history_id: 301,
          receiver_history_id: 302,
          amount_debited: 10.5,
          amount_credited: 9.5,
          is_free_withdraw: false,
        },
      },
    },
  })
  @ApiBadRequestResponse({
    description:
      'KYC, 2FA, emailCode sai/hết hạn, số dư, user nhận không tồn tại, chuyển cho chính mình, vượt max withdraw, …',
  })
  @UseGuards(JwtAuthGuard)
  @UsePipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
      forbidNonWhitelisted: true,
    }),
  )
  @HttpCode(HttpStatus.OK)
  async internalExchange(
    @Body() dto: InternalExchangeDto,
    @Request() req: any,
  ) {
    const user = req.user;
    const result = await this.walletsService.internalExchangeTransfer(
      user.uid,
      dto.recipientUserId,
      dto.coinId,
      dto.amount,
      dto.emailCode,
      dto.twoFactorCode,
    );
    return {
      statusCode: HttpStatus.OK,
      message: result.message,
      data: {
        sender_history_id: result.sender_history_id,
        receiver_history_id: result.receiver_history_id,
        amount_debited: result.amount_debited,
        amount_credited: result.amount_credited,
        is_free_withdraw: result.is_free_withdraw,
      },
    };
  }

  @Get('transaction-history')
  @ApiOperation({ summary: 'Lấy lịch sử giao dịch nạp/rút' })
  @ApiOkResponse({
    description: 'Lịch sử giao dịch',
    schema: {
      example: {
        statusCode: 200,
        message: 'Get transaction history successfully',
        data: [
          {
            id: 201,
            type: 'withdraw',
            option: 'manual',
            coin_id: 1,
            amount: 10.5,
            hash: '0xabc123def456',
            status: 'success',
          },
        ],
      },
    },
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getTransactionHistory(
    @Query() query: TransactionHistoryDto,
    @Request() req: any,
  ) {
    const user = req.user; // User from JWT token
    const histories = await this.walletsService.getTransactionHistory(
      user.uid,
      query.coin,
      query.network,
      query.type,
    );

    // Transform response để bỏ tiền tố wh_ và format dữ liệu
    const transformedHistories = histories.map((history) => ({
      id: history.wh_id,
      wallet_network_id: history.wh_wallet_netword_id,
      type: history.wh_type,
      option: history.wh_option,
      coin_id: history.wh_coins,
      amount: parseFloat(history.wh_amount.toString()),
      hash: history.wh_hash,
      image_verify: history.wh_imnage_veryfy,
      status: history.wh_status,
      node: history.wh_node,
      user_id: history.wh_user,
      created_at: history.created_at,
      updated_at: history.updated_at,
    }));

    return {
      statusCode: HttpStatus.OK,
      message: 'Get transaction history successfully',
      data: transformedHistories,
    };
  }
}
