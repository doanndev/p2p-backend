import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  Request,
  UseGuards,
  UsePipes,
  ValidationPipe,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { SmartRefService } from './smart-ref.service';
import { SmartRefWithdrawDto } from './dto/smart-ref-withdraw.dto';
import { AdminJwtAuthGuard } from '../admins/guards/admin-jwt-auth.guard';
import { AdminPermissionReadReferralGuard } from '../admins/guards/admin-permission-read-referral.guard';
import { AdminRefTreeQueryDto } from './dto/admin-ref-tree-query.dto';

@ApiTags('Smart Ref')
@ApiCookieAuth('access_token')
@Controller('smart-ref')
export class SmartRefController {
  constructor(private readonly smartRefService: SmartRefService) {}

  @Get('levels')
  @ApiOperation({ summary: 'Lấy tất cả tầng smart ref và % hoa hồng' })
  @ApiOkResponse({
    schema: {
      example: {
        statusCode: 200,
        message: 'Get smart ref levels successfully',
        data: [
          { level: 1, percentage: 10 },
          { level: 2, percentage: 5 },
        ],
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  async getLevels() {
    const data = await this.smartRefService.getAllLevelSettings();
    return {
      statusCode: HttpStatus.OK,
      message: 'Get smart ref levels successfully',
      data,
    };
  }

  @Get('me/invitees')
  @ApiOperation({ summary: 'Lấy danh sách invitee của user theo từng cấp' })
  @ApiOkResponse({
    schema: {
      example: {
        statusCode: 200,
        message: 'Get smart ref invitees successfully',
        data: [
          {
            level: 1,
            total_invitees: 2,
            invitees: [
              {
                uid: 101,
                uname: 'john_doe',
                uemail: 'john@example.com',
                uphone: '+84901234567',
                uavatar: 'https://cdn.example.com/avatars/101.png',
                uref: 'ABC12345',
                ufulllname: 'John Doe',
                ulevel: 3,
                created_at: '2026-04-19T09:30:00.000Z',
              },
            ],
          },
          {
            level: 2,
            total_invitees: 1,
            invitees: [
              {
                uid: 205,
                uname: 'jane_smith',
                uemail: 'jane@example.com',
                uphone: null,
                uavatar: null,
                uref: 'XYZ67890',
                ufulllname: 'Jane Smith',
                ulevel: 1,
                created_at: '2026-04-18T12:00:00.000Z',
              },
            ],
          },
        ],
      },
    },
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getMyInvitees(@Request() req: { user: { uid: number } }) {
    const data = await this.smartRefService.getMyInviteesByLevel(req.user.uid);
    return {
      statusCode: HttpStatus.OK,
      message: 'Get smart ref invitees successfully',
      data,
    };
  }

  @Get('me/rewards')
  @ApiOperation({ summary: 'Lấy tổng reward smart ref chưa rút' })
  @ApiOkResponse({
    schema: {
      example: {
        statusCode: 200,
        message: 'Get smart ref reward successfully',
        data: {
          amount: 123.45678901,
        },
      },
    },
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getMyRewards(@Request() req: { user: { uid: number } }) {
    const amount = await this.smartRefService.getMyRewardAmount(req.user.uid);
    return {
      statusCode: HttpStatus.OK,
      message: 'Get smart ref reward successfully',
      data: {
        amount,
      },
    };
  }

  @Post('me/withdraw')
  @ApiOperation({ summary: 'Rút reward smart ref về ví ngoài' })
  @ApiOkResponse({
    schema: {
      example: {
        statusCode: 200,
        message: 'Withdraw smart ref reward successfully',
        data: {
          amount: 123.45678901,
          withdraw_history_id: 55,
          tx_hash:
            '0x9d40c7f6b4c7744f15fbb84c5f95bdf9f6f6ea4cd67f0677f4b71f5d51e6e5c1',
          status: 'withdrawn',
        },
      },
    },
  })
  @UseGuards(JwtAuthGuard)
  @UsePipes(new ValidationPipe({ whitelist: true, transform: true }))
  @HttpCode(HttpStatus.OK)
  async withdrawMyReward(
    @Request() req: { user: { uid: number } },
    @Body() dto: SmartRefWithdrawDto,
  ) {
    const result = await this.smartRefService.withdrawMyReward(
      req.user.uid,
      dto.networkId,
      dto.address,
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Withdraw smart ref reward successfully',
      data: result,
    };
  }

  @Get('admin/statistics')
  @ApiOperation({ summary: 'Admin thống kê referral (cache 30 phút)' })
  @ApiOkResponse({
    schema: {
      example: {
        statusCode: 200,
        message: 'Get admin referral statistics successfully',
        data: {
          total_ref_paid_usd: 12500.5,
          total_invited_users: 2345,
          total_referral_transaction_value_usd: 845000.25,
        },
      },
    },
  })
  @ApiCookieAuth('admin_access_token')
  @UseGuards(AdminJwtAuthGuard, AdminPermissionReadReferralGuard)
  @HttpCode(HttpStatus.OK)
  async getAdminReferralStatistics() {
    const data = await this.smartRefService.getAdminReferralStatistics();
    return {
      statusCode: HttpStatus.OK,
      message: 'Get admin referral statistics successfully',
      data,
    };
  }

  @Get('admin/referrals')
  @ApiOperation({
    summary:
      'Admin lấy danh sách referral + invitees (sort F1 từ đông đến ít) và xem tree downline',
  })
  @ApiOkResponse({
    schema: {
      example: {
        statusCode: 200,
        message: 'Get admin referrals successfully',
        data: [
          {
            referral: {
              uid: 10,
              uname: 'alice',
              uemail: 'alice@example.com',
              ufulllname: 'Alice',
              uavatar: null,
              created_at: '2026-04-22T10:00:00.000Z',
            },
            f1_count: 12,
            total_invitees: 30,
            invitees_by_level: [{ level: 1, count: 12, invitees: [] }],
          },
        ],
      },
    },
  })
  @ApiCookieAuth('admin_access_token')
  @UseGuards(AdminJwtAuthGuard, AdminPermissionReadReferralGuard)
  @HttpCode(HttpStatus.OK)
  async getAdminReferralsWithInvitees() {
    const data = await this.smartRefService.getAdminReferralsWithInvitees();
    return {
      statusCode: HttpStatus.OK,
      message: 'Get admin referrals successfully',
      data,
    };
  }

  @Get('admin/downline-tree')
  @ApiOperation({
    summary:
      'Admin truy vấn cây downline đa tầng của một user bất kỳ (theo nhánh F1)',
  })
  @ApiOkResponse({
    schema: {
      example: {
        statusCode: 200,
        message: 'Get admin downline tree successfully',
        data: {
          user: { uid: 10, uname: 'alice' },
          depth: 0,
          children: [],
        },
      },
    },
  })
  @ApiCookieAuth('admin_access_token')
  @UseGuards(AdminJwtAuthGuard, AdminPermissionReadReferralGuard)
  @HttpCode(HttpStatus.OK)
  async getAdminDownlineTree(@Query() query: AdminRefTreeQueryDto) {
    const data = await this.smartRefService.getAdminDownlineTree(
      query.userId,
      query.maxDepth ?? 5,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'Get admin downline tree successfully',
      data,
    };
  }
}
