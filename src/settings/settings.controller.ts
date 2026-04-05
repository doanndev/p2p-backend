import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Request,
  UseGuards,
} from '@nestjs/common';
import { SettingsService } from './settings.service';
import { VideoSettingsDto } from './dto/video-settings.dto';
import { WithdrawSettingsDto } from './dto/withdraw-settings.dto';
import { AdminJwtAuthGuard } from '../admins/guards/admin-jwt-auth.guard';
import { AdminPermissionGuard } from '../admins/guards/admin-permission.guard';
import { AdminPermissionReadSettingsGuard } from '../admins/guards/admin-permission-read-settings.guard';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('Settings')
@ApiCookieAuth('admin_access_token')
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @ApiOperation({ summary: 'Lấy cấu hình admin settings tổng hợp' })
  @ApiOkResponse({
    description: 'Thông tin settings tổng hợp',
    schema: {
      example: {
        statusCode: 200,
        data: {
          video: { turn_default: 3, devices_default: 2, time_gap: 30 },
          withdraw: { turn_free: 2 },
        },
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionReadSettingsGuard)
  @HttpCode(HttpStatus.OK)
  async getAdminSettings() {
    return this.settingsService.getAdminSettingsSummary();
  }

  @Post('video')
  @ApiOperation({ summary: 'Cập nhật cấu hình video' })
  @ApiBody({ type: VideoSettingsDto })
  @ApiOkResponse({
    description: 'Cập nhật video settings thành công',
    schema: {
      example: {
        statusCode: 200,
        message: 'Update video settings successfully',
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionGuard)
  @HttpCode(HttpStatus.OK)
  async updateVideoSettings(
    @Body() videoSettingsDto: VideoSettingsDto,
    @Request() req: any,
  ) {
    const admin = req.user;
    return this.settingsService.updateVideoSettings(
      videoSettingsDto,
      admin.admin_id,
    );
  }

  @Post('withdraw')
  @ApiOperation({ summary: 'Cập nhật cấu hình rút tiền' })
  @ApiBody({ type: WithdrawSettingsDto })
  @ApiOkResponse({
    description: 'Cập nhật withdraw settings thành công',
    schema: {
      example: {
        statusCode: 200,
        message: 'Update withdraw settings successfully',
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionGuard)
  @HttpCode(HttpStatus.OK)
  async updateWithdrawSettings(
    @Body() withdrawSettingsDto: WithdrawSettingsDto,
    @Request() req: any,
  ) {
    const admin = req.user;
    return this.settingsService.updateWithdrawSettings(
      withdrawSettingsDto,
      admin.admin_id,
    );
  }
}
