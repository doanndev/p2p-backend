import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  UseGuards,
} from '@nestjs/common';
import {
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { AdminsPendingSummaryService } from './admins-pending-summary.service';
import { AdminJwtAuthGuard } from './guards/admin-jwt-auth.guard';
import { AdminPermissionReadUsersGuard } from './guards/admin-permission-read-users.guard';

@ApiTags('Admin pending summary')
@ApiCookieAuth('admin_access_token')
@Controller('admins/pending-summary')
export class AdminsPendingSummaryController {
  constructor(
    private readonly adminsPendingSummaryService: AdminsPendingSummaryService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'Số lượng KYC và bank request đang chờ xử lý (badge sidebar admin)',
  })
  @ApiOkResponse({
    description: 'Pending counts for KYC review and bank approvals',
    schema: {
      example: {
        statusCode: 200,
        data: {
          kyc: 5,
          kyc_pending: 4,
          kyc_retry: 1,
          bank_requests: 3,
          bank_create: 1,
          bank_orderbook_change: 2,
        },
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionReadUsersGuard)
  @HttpCode(HttpStatus.OK)
  getPendingSummary() {
    return this.adminsPendingSummaryService.getPendingSummary();
  }
}
