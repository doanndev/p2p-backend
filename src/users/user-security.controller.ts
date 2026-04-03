import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
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
import { UserSecurityService } from './user-security.service';
import { TwoFactorVerifySetupDto } from './dto/two-factor-verify-setup.dto';
import { TwoFactorDisableDto } from './dto/two-factor-disable.dto';

@ApiTags('Users — Security (2FA)')
@ApiCookieAuth('access_token')
@UsePipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
  }),
)
@Controller('users/security/2fa')
export class UserSecurityController {
  constructor(private readonly userSecurityService: UserSecurityService) {}

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Trạng thái 2FA (đã bật / đang chờ xác nhận setup)',
  })
  @ApiOkResponse({
    description: 'enabled = true khi đã verify mã sau khi quét QR',
  })
  async status(@Request() req: { user: { uid: number } }) {
    const data = await this.userSecurityService.getTwoFactorStatus(
      req.user.uid,
    );
    return {
      statusCode: HttpStatus.OK,
      message: 'OK',
      data,
    };
  }

  @Post('setup')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Bắt đầu bật 2FA: tạo secret, trả QR (data URL) và otpauth URL. Gọi verify-setup với mã 6 số để kích hoạt.',
  })
  async setup(@Request() req: { user: { uid: number } }) {
    const data = await this.userSecurityService.setupTwoFactor(req.user.uid);
    return {
      statusCode: HttpStatus.OK,
      message:
        'Scan the QR code with Google Authenticator, then confirm with POST /users/security/2fa/verify-setup',
      data,
    };
  }

  @Post('verify-setup')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xác nhận mã TOTP để bật 2FA' })
  async verifySetup(
    @Request() req: { user: { uid: number } },
    @Body() dto: TwoFactorVerifySetupDto,
  ) {
    return this.userSecurityService.verifyTwoFactorSetup(
      req.user.uid,
      dto.code,
    );
  }

  @Post('disable')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Tắt 2FA: cần mật khẩu + mã TOTP khi đã bật; chỉ mật khẩu khi đang pending setup (chưa verify)',
  })
  async disable(
    @Request() req: { user: { uid: number } },
    @Body() dto: TwoFactorDisableDto,
  ) {
    return this.userSecurityService.disableTwoFactor(
      req.user.uid,
      dto.password,
      dto.code,
    );
  }
}
