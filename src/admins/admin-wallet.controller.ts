import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AdminsWalletOpsService } from './admins-wallet-ops.service';
import { AdminJwtAuthGuard } from './guards/admin-jwt-auth.guard';
import { AdminPermissionReadCoinsGuard } from './guards/admin-permission-read-coins.guard';
import { AdminPermissionCreateCoinsGuard } from './guards/admin-permission-create-coins.guard';
import { AdminPermissionUpdateCoinsGuard } from './guards/admin-permission-update-coins.guard';
import { AdminPermissionReadNetworksGuard } from './guards/admin-permission-read-networks.guard';
import { AdminPermissionCreateNetworksGuard } from './guards/admin-permission-create-networks.guard';
import { AdminPermissionUpdateNetworksGuard } from './guards/admin-permission-update-networks.guard';
import { AdminPermissionReadUsersGuard } from './guards/admin-permission-read-users.guard';
import { AdminSuperAdminGuard } from './guards/admin-super-admin.guard';
import { AddCoinDto } from './dto/add-coin.dto';
import { UpdateCoinDto } from './dto/update-coin.dto';
import { AddNetworkDto } from './dto/add-network.dto';
import { UpdateNetworkDto } from './dto/update-network.dto';
import { SearchWalletDto } from './dto/search-wallet.dto';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('Admin Wallets')
@ApiCookieAuth('admin_access_token')
@Controller('admins/wallets')
export class AdminWalletController {
  constructor(
    private readonly adminsWalletOpsService: AdminsWalletOpsService,
  ) {}

  @Get('main')
  @ApiOperation({ summary: 'Lấy danh sách ví tổng (main wallets)' })
  @ApiOkResponse({
    description: 'Danh sách main wallets',
    schema: {
      example: {
        statusCode: 200,
        data: [
          {
            network: 'BSC',
            address: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
          },
        ],
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminSuperAdminGuard)
  @HttpCode(HttpStatus.OK)
  async getMainWallets() {
    const result = await this.adminsWalletOpsService.getMainWallets();
    return result;
  }

  @Get('fee-subsidy')
  @ApiOperation({ summary: 'Lấy danh sách ví fee subsidy' })
  @ApiOkResponse({
    description: 'Danh sách ví fee subsidy',
    schema: {
      example: {
        statusCode: 200,
        data: [
          {
            network: 'ETH',
            address: '0x1111222233334444555566667777888899990000',
          },
        ],
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminSuperAdminGuard)
  @HttpCode(HttpStatus.OK)
  async getFeeSubsidyWallets() {
    const result = await this.adminsWalletOpsService.getFeeSubsidyWallets();
    return result;
  }

  @Get('list-coins')
  @ApiOperation({ summary: 'Lấy danh sách coin (admin)' })
  @ApiOkResponse({
    description: 'Danh sách coin',
    schema: {
      example: {
        statusCode: 200,
        data: [{ id: 1, symbol: 'USDT', name: 'Tether USD' }],
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionReadCoinsGuard)
  @HttpCode(HttpStatus.OK)
  async getListCoins() {
    const result = await this.adminsWalletOpsService.getListCoins();
    return result;
  }

  @Post('add-coin')
  @ApiOperation({ summary: 'Thêm coin mới' })
  @ApiBody({ type: AddCoinDto })
  @ApiCreatedResponse({
    description: 'Thêm coin thành công',
    schema: {
      example: {
        statusCode: 201,
        message: 'Add coin successfully',
        data: { id: 9, symbol: 'BTC' },
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionCreateCoinsGuard)
  @HttpCode(HttpStatus.CREATED)
  async addCoin(@Body() addCoinDto: AddCoinDto, @Request() req: any) {
    const admin = req.user;
    const result = await this.adminsWalletOpsService.addCoin(
      addCoinDto,
      admin.admin_id,
    );
    return result;
  }

  @Patch('update-coin/:id')
  @ApiOperation({ summary: 'Cập nhật coin theo id' })
  @ApiBody({ type: UpdateCoinDto })
  @ApiOkResponse({
    description: 'Cập nhật coin thành công',
    schema: {
      example: { statusCode: 200, message: 'Update coin successfully' },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionUpdateCoinsGuard)
  @HttpCode(HttpStatus.OK)
  async updateCoin(
    @Param('id') id: string,
    @Body() updateCoinDto: UpdateCoinDto,
    @Request() req: any,
  ) {
    const coinId = parseInt(id, 10);
    const admin = req.user;
    const result = await this.adminsWalletOpsService.updateCoin(
      coinId,
      updateCoinDto,
      admin.admin_id,
    );
    return result;
  }

  @Get('list-networks')
  @ApiOperation({ summary: 'Lấy danh sách network (admin)' })
  @ApiOkResponse({
    description: 'Danh sách network',
    schema: {
      example: {
        statusCode: 200,
        data: [{ id: 1, symbol: 'BSC', name: 'Binance Smart Chain' }],
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionReadNetworksGuard)
  @HttpCode(HttpStatus.OK)
  async getListNetworks() {
    const result = await this.adminsWalletOpsService.getListNetworks();
    return result;
  }

  @Post('add-network')
  @ApiOperation({ summary: 'Thêm network mới' })
  @ApiBody({ type: AddNetworkDto })
  @ApiCreatedResponse({
    description: 'Thêm network thành công',
    schema: {
      example: {
        statusCode: 201,
        message: 'Add network successfully',
        data: { id: 5, symbol: 'SOL' },
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionCreateNetworksGuard)
  @HttpCode(HttpStatus.CREATED)
  async addNetwork(@Body() addNetworkDto: AddNetworkDto, @Request() req: any) {
    const admin = req.user;
    const result = await this.adminsWalletOpsService.addNetwork(
      addNetworkDto,
      admin.admin_id,
    );
    return result;
  }

  @Patch('update-network/:id')
  @ApiOperation({ summary: 'Cập nhật network theo id' })
  @ApiBody({ type: UpdateNetworkDto })
  @ApiOkResponse({
    description: 'Cập nhật network thành công',
    schema: {
      example: { statusCode: 200, message: 'Update network successfully' },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionUpdateNetworksGuard)
  @HttpCode(HttpStatus.OK)
  async updateNetwork(
    @Param('id') id: string,
    @Body() updateNetworkDto: UpdateNetworkDto,
    @Request() req: any,
  ) {
    const networkId = parseInt(id, 10);
    const admin = req.user;
    const result = await this.adminsWalletOpsService.updateNetwork(
      networkId,
      updateNetworkDto,
      admin.admin_id,
    );
    return result;
  }

  @Get('users/:uid')
  @ApiOperation({ summary: 'Lấy ví của user theo user id' })
  @ApiOkResponse({
    description: 'Danh sách ví của user',
    schema: {
      example: {
        statusCode: 200,
        data: [
          {
            network: 'BSC',
            public_key: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
          },
        ],
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionReadUsersGuard)
  @HttpCode(HttpStatus.OK)
  async getUserWallets(@Param('uid') uid: string) {
    const userId = parseInt(uid, 10);
    const result = await this.adminsWalletOpsService.getUserWallets(userId);
    return result;
  }

  @Post('search')
  @ApiOperation({ summary: 'Tìm kiếm ví theo từ khóa' })
  @ApiBody({ type: SearchWalletDto })
  @ApiOkResponse({
    description: 'Kết quả tìm kiếm ví',
    schema: {
      example: {
        statusCode: 200,
        data: [
          {
            user_id: 120,
            address: '0x742d35Cc6634C0532925a3b844Bc454e4438f44e',
          },
        ],
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionReadUsersGuard)
  @HttpCode(HttpStatus.OK)
  async searchWallet(@Body() searchWalletDto: SearchWalletDto) {
    const result = await this.adminsWalletOpsService.searchWallet(
      searchWalletDto.q,
    );
    return result;
  }

  @Post('main-withdraw')
  @ApiOperation({ summary: 'Thực thi lệnh rút từ main wallet' })
  @ApiOkResponse({
    description: 'Thực thi main withdraw thành công',
    schema: {
      example: {
        statusCode: 200,
        message: 'Process main withdraw successfully',
        data: { processed: 12 },
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminSuperAdminGuard)
  @HttpCode(HttpStatus.OK)
  async processMainWithdraw(@Request() req: any) {
    const admin = req.user;
    const result = await this.adminsWalletOpsService.processMainWithdraw(
      admin.admin_id,
      { fromApi: true },
    );
    return result;
  }

  @Get(':id/histories')
  @ApiOperation({ summary: 'Lịch sử ví của user theo option' })
  @ApiOkResponse({
    description: 'Lịch sử ví user',
    schema: {
      example: {
        statusCode: 200,
        data: [{ id: 201, type: 'withdraw', amount: 20, status: 'success' }],
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionReadUsersGuard)
  @HttpCode(HttpStatus.OK)
  async getUserWalletHistories(
    @Param('id') id: string,
    @Query('option') option?: string,
  ) {
    const userId = parseInt(id, 10);
    const result = await this.adminsWalletOpsService.getUserWalletHistories(
      userId,
      option,
    );
    return result;
  }
}
