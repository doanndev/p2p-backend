import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import { AdminsStatisticsService } from './admins-statistics.service';
import { AdminJwtAuthGuard } from './guards/admin-jwt-auth.guard';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('Admin Statistics')
@ApiCookieAuth('admin_access_token')
@Controller('admins/statistical')
export class AdminsStatisticalController {
  constructor(
    private readonly adminsStatisticsService: AdminsStatisticsService,
  ) {}

  @Get('platform')
  @ApiOperation({ summary: 'Thống kê tổng quan nền tảng' })
  @ApiOkResponse({
    description: 'Thống kê nền tảng',
    schema: {
      example: {
        statusCode: 200,
        data: {
          total_users: 15230,
          total_wallets: 32880,
          total_withdraws: 1205,
        },
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getPlatformStatistics() {
    const result = await this.adminsStatisticsService.getPlatformStatistics();
    return result;
  }

  @Get('running')
  @ApiOperation({ summary: 'Thống kê runtime hệ thống' })
  @ApiOkResponse({
    description: 'Thống kê runtime',
    schema: {
      example: {
        statusCode: 200,
        data: { active_users_today: 920, pending_kyc: 42, queue_jobs: 5 },
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getRunningStatistics() {
    const result = await this.adminsStatisticsService.getRunningStatistics();
    return result;
  }
}
