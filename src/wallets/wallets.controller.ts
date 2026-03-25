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
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';
import { WalletsService } from './wallets.service';
import { CreateWalletDto } from './dto/create-wallet.dto';
import { WithdrawDto } from './dto/withdraw.dto';
import { TransactionHistoryDto } from './dto/transaction-history.dto';
import { TransferRewardsHistoryDto } from './dto/transfer-rewards-history.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import {
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
  @ApiOperation({ summary: 'Chuyển số dư reward sang ví chính' })
  @ApiOkResponse({
    description: 'Chuyển reward thành công',
    schema: {
      example: {
        statusCode: 200,
        message: 'Transfer reward successfully',
        data: { new_balance_reward: 0, updated_coins: 3 },
      },
    },
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async transferReward(@Request() req: any) {
    const user = req.user; // User from JWT token
    const result = await this.walletsService.transferReward(user.uid);
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
  @ApiOperation({ summary: 'Rút coin về ví ngoài' })
  @ApiBody({ type: WithdrawDto })
  @ApiOkResponse({
    description: 'Rút coin thành công',
    schema: {
      example: {
        statusCode: 200,
        message: 'Withdraw successfully',
        data: { transaction_hash: '0xabc123def456', history_id: 201 },
      },
    },
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async withdraw(@Body() withdrawDto: WithdrawDto, @Request() req: any) {
    const user = req.user; // User from JWT token
    const result = await this.walletsService.withdraw(
      user.uid,
      withdrawDto.network,
      withdrawDto.coin,
      withdrawDto.address,
      withdrawDto.amount,
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
