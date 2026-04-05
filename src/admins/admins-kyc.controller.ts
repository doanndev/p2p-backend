import {
  Controller,
  Get,
  Post,
  Query,
  Param,
  Body,
  HttpCode,
  HttpStatus,
  UseGuards,
  Request,
} from '@nestjs/common';
import { AdminsService } from './admins.service';
import { AdminJwtAuthGuard } from './guards/admin-jwt-auth.guard';
import { AdminPermissionReadUsersGuard } from './guards/admin-permission-read-users.guard';
import { UpdateKycStatusDto } from './dto/update-kyc-status.dto';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('Admin KYC')
@ApiCookieAuth('admin_access_token')
@Controller('admins/kyc')
export class AdminsKycController {
  constructor(private readonly adminsService: AdminsService) {}

  @Get('list')
  @ApiOperation({
    summary:
      'Lấy danh sách KYC theo trạng thái. Filter status=pending chỉ gồm hồ sơ đã có ảnh cầm giấy; challenge_pending = đang chờ user gửi ảnh cầm giấy.',
  })
  @ApiOkResponse({
    description: 'Danh sách KYC',
    schema: {
      example: {
        statusCode: 200,
        data: [
          {
            user_id: 120,
            status: 'pending',
            created_at: '2026-03-23T10:00:00.000Z',
          },
        ],
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionReadUsersGuard)
  @HttpCode(HttpStatus.OK)
  async getKycList(@Query('status') status?: string) {
    const result = await this.adminsService.getKycList(status);
    return result;
  }

  @Get(':user_id')
  @ApiOperation({ summary: 'Lịch sử KYC của một user' })
  @ApiOkResponse({
    description: 'Lịch sử KYC theo user',
    schema: {
      example: {
        statusCode: 200,
        data: [{ id: 31, status: 'retry', notes: 'Ảnh mờ' }],
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionReadUsersGuard)
  @HttpCode(HttpStatus.OK)
  async getUserKycHistory(@Param('user_id') userId: string) {
    const uid = parseInt(userId, 10);
    const result = await this.adminsService.getUserKycHistory(uid);
    return result;
  }

  @Post('check/:user_id')
  @ApiOperation({ summary: 'Kiểm tra nhanh trạng thái KYC của user' })
  @ApiOkResponse({
    description: 'Trạng thái KYC hiện tại',
    schema: { example: { statusCode: 200, status: 'pending' } },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionReadUsersGuard)
  @HttpCode(HttpStatus.OK)
  async checkUserKycStatus(@Param('user_id') userId: string) {
    const uid = parseInt(userId, 10);
    const result = await this.adminsService.checkUserKycStatus(uid);
    return result;
  }

  @Post(':user_id/update')
  @ApiOperation({ summary: 'Cập nhật kết quả xử lý KYC của user' })
  @ApiBody({ type: UpdateKycStatusDto })
  @ApiOkResponse({
    description: 'Cập nhật KYC thành công',
    schema: {
      example: {
        statusCode: 200,
        message: 'Update KYC status successfully',
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionReadUsersGuard)
  @HttpCode(HttpStatus.OK)
  async updateKycStatus(
    @Param('user_id') userId: string,
    @Body() updateKycStatusDto: UpdateKycStatusDto,
    @Request() req: any,
  ) {
    const uid = parseInt(userId, 10);
    const admin = req.user;
    const result = await this.adminsService.updateKycStatus(
      uid,
      updateKycStatusDto,
      admin.admin_id,
    );
    return result;
  }
}
