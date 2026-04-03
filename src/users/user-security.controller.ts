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
  ApiBadRequestResponse,
  ApiBody,
  ApiConflictResponse,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UserSecurityService } from './user-security.service';
import { TwoFactorVerifySetupDto } from './dto/two-factor-verify-setup.dto';
import { TwoFactorDisableDto } from './dto/two-factor-disable.dto';

const swaggerTwoFaStatusOk = {
  statusCode: 200,
  message: 'OK',
  data: { enabled: true, pendingSetup: false },
};

const swaggerTwoFaSetupOk = {
  statusCode: 200,
  message:
    'Scan the QR code with Google Authenticator, then confirm with POST /users/security/2fa/verify-setup',
  data: {
    otpauthUrl:
      'otpauth://totp/MyApp:user%40example.com?secret=JBSWY3DPEHPK3PXP&issuer=MyApp&algorithm=SHA1&digits=6&period=30',
    qrCodeDataUrl:
      'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    manualEntryKey: 'JBSWY3DPEHPK3PXP',
  },
};

const swaggerTwoFaVerifyOk = {
  statusCode: 200,
  message: 'Two-factor authentication enabled successfully',
};

const swaggerTwoFaDisableOk = {
  statusCode: 200,
  message: 'Two-factor authentication disabled successfully',
};

const swaggerTwoFaBadRequest = {
  statusCode: 400,
  message: 'Invalid verification code',
  error: 'Bad Request',
};

const swaggerTwoFaConflict = {
  statusCode: 409,
  message:
    'Two-factor authentication is already enabled. Disable it before setting up again.',
  error: 'Conflict',
};

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
    summary: 'Trạng thái 2FA',
    description:
      '**enabled**: đã bật 2FA (đã verify mã sau khi quét QR). ' +
      '**pendingSetup**: đã gọi `POST .../setup` nhưng chưa gọi `verify-setup` — secret tạm lưu, chưa bắt buộc mã trên API nhạy cảm.',
  })
  @ApiOkResponse({
    description:
      'Thành công. **enabled=true** khi đã verify setup. **pendingSetup=true** khi đã `POST /setup` nhưng chưa `verify-setup`. ' +
      'Ví dụ pending: `data: { enabled: false, pendingSetup: true }`.',
    schema: { example: swaggerTwoFaStatusOk },
  })
  @ApiUnauthorizedResponse({
    description: 'Chưa đăng nhập hoặc cookie `access_token` hết hạn',
    schema: { example: { statusCode: 401, message: 'Unauthorized' } },
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
    summary: 'Bắt đầu bật 2FA (QR + secret)',
    description: `Luồng đề xuất:
1. Gọi endpoint này (đã có JWT).
2. Hiển thị \`data.qrCodeDataUrl\` trong thẻ \`<img />\` hoặc dùng \`otpauthUrl\` trên mobile.
3. Thêm tài khoản trong Google Authenticator (hoặc app TOTP khác).
4. Gọi \`POST .../verify-setup\` với mã 6 số từ app.

**Lưu ý:** 2FA chưa coi là bật cho đến khi verify thành công. Nếu đã bật 2FA thì API trả **409**.`,
  })
  @ApiOkResponse({
    description: 'Trả secret + QR; chưa coi là đã bật 2FA cho đến khi verify-setup.',
    schema: { example: swaggerTwoFaSetupOk },
  })
  @ApiConflictResponse({
    description: 'Đã bật 2FA — cần `disable` trước khi setup lại',
    schema: { example: swaggerTwoFaConflict },
  })
  @ApiBadRequestResponse({
    description: 'User không tồn tại (hiếm)',
    schema: { example: swaggerTwoFaBadRequest },
  })
  @ApiUnauthorizedResponse({
    description: 'Chưa đăng nhập hoặc cookie `access_token` hết hạn',
    schema: { example: { statusCode: 401, message: 'Unauthorized' } },
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
  @ApiOperation({
    summary: 'Xác nhận mã TOTP để bật 2FA',
    description:
      'Gửi mã 6 số từ app Authenticator. Sau khi thành công, `enabled` = true và các API nhạy cảm (rút tiền, đổi mật khẩu, …) sẽ yêu cầu `twoFactorCode`.',
  })
  @ApiBody({
    type: TwoFactorVerifySetupDto,
    examples: {
      macDinh: { summary: 'Mã 6 số từ app', value: { code: '123456' } },
    },
  })
  @ApiOkResponse({
    description: '2FA đã được kích hoạt',
    schema: { example: swaggerTwoFaVerifyOk },
  })
  @ApiBadRequestResponse({
    description:
      'Mã sai / chưa có pending setup (chưa gọi setup) / user không tồn tại',
    schema: { example: swaggerTwoFaBadRequest },
  })
  @ApiConflictResponse({
    description: '2FA đã được bật từ trước',
    schema: {
      example: {
        statusCode: 409,
        message: 'Two-factor authentication is already enabled',
        error: 'Conflict',
      },
    },
  })
  @ApiUnauthorizedResponse({
    description: 'Chưa đăng nhập hoặc cookie `access_token` hết hạn',
    schema: { example: { statusCode: 401, message: 'Unauthorized' } },
  })
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
    summary: 'Tắt 2FA hoặc hủy setup đang chờ',
    description: `**Đã bật 2FA:** bắt buộc \`password\` + \`code\` (mã TOTP hiện tại).
**Chỉ pending (chưa verify):** chỉ cần \`password\`; không gửi \`code\`.

Sau khi tắt, secret xóa và các API nhạy cảm không còn yêu cầu \`twoFactorCode\`.`,
  })
  @ApiBody({
    type: TwoFactorDisableDto,
    examples: {
      daBat2FA: {
        summary: 'Đã bật 2FA — cần password + code',
        value: { password: 'CurrentPassword@123', code: '123456' },
      },
      pendingOnly: {
        summary: 'Chỉ đang pending setup — chỉ password',
        value: { password: 'CurrentPassword@123' },
      },
    },
  })
  @ApiOkResponse({
    description: 'Đã tắt 2FA / đã hủy pending setup',
    schema: { example: swaggerTwoFaDisableOk },
  })
  @ApiBadRequestResponse({
    description:
      'Mật khẩu sai / thiếu mã khi đã bật 2FA / mã TOTP sai / chưa cấu hình 2FA',
    schema: { example: swaggerTwoFaBadRequest },
  })
  @ApiUnauthorizedResponse({
    description: 'Chưa đăng nhập hoặc cookie `access_token` hết hạn',
    schema: { example: { statusCode: 401, message: 'Unauthorized' } },
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
