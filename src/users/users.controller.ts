import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Res,
  Request,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  Query,
  HttpException,
} from '@nestjs/common';
import { FilesInterceptor } from '@nestjs/platform-express';
import { Response } from 'express';
import { UsersService } from './users.service';
import { RegisterDto } from './dto/register.dto';
import { LoginDto } from './dto/login.dto';
import { VerifyEmailDto } from './dto/verify-email.dto';
import { KycDto } from './dto/kyc.dto';
import { ResetPasswordDto } from './dto/reset-password.dto';
import { SetNewPasswordDto } from './dto/set-new-password.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { RegisterKolDto } from './dto/register-kol.dto';
import { SubmitKolArticleDto } from './dto/submit-kol-article.dto';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { multerConfig } from './multer.config';
import {
  ApiBody,
  ApiCreatedResponse,
  ApiConsumes,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('Users')
@ApiCookieAuth('access_token')
@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post('register')
  @ApiOperation({ summary: 'Đăng ký tài khoản người dùng' })
  @ApiBody({ type: RegisterDto })
  @ApiCreatedResponse({
    description: 'Đăng ký thành công',
    schema: {
      example: {
        statusCode: 201,
        message: 'Register successfully',
        user: {
          id: 120,
          uname: 'john_doe',
          uemail: 'john@example.com',
        },
      },
    },
  })
  @HttpCode(HttpStatus.CREATED)
  async register(
    @Body() registerDto: RegisterDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result =
      await this.usersService.registerAndGenerateTokens(registerDto);

    // Set httpOnly cookies với domain nếu có
    const accessTokenOptions: any = {
      httpOnly: result.cookieOptions.access_token.httpOnly,
      secure: result.cookieOptions.access_token.secure,
      sameSite: result.cookieOptions.access_token.sameSite,
      expires: result.cookieOptions.access_token.expires,
      path: result.cookieOptions.access_token.path,
    };
    if (result.cookieOptions.access_token.domain) {
      accessTokenOptions.domain = result.cookieOptions.access_token.domain;
    }

    const refreshTokenOptions: any = {
      httpOnly: result.cookieOptions.refresh_token.httpOnly,
      secure: result.cookieOptions.refresh_token.secure,
      sameSite: result.cookieOptions.refresh_token.sameSite,
      expires: result.cookieOptions.refresh_token.expires,
      path: result.cookieOptions.refresh_token.path,
    };
    if (result.cookieOptions.refresh_token.domain) {
      refreshTokenOptions.domain = result.cookieOptions.refresh_token.domain;
    }

    // Set cookies using res.cookie() - Express will handle Set-Cookie headers
    res.cookie(
      'access_token',
      result.cookieOptions.access_token.value,
      accessTokenOptions,
    );
    res.cookie(
      'refresh_token',
      result.cookieOptions.refresh_token.value,
      refreshTokenOptions,
    );

    return result.response;
  }

  @Post('login')
  @ApiOperation({ summary: 'Đăng nhập người dùng và set cookie token' })
  @ApiBody({ type: LoginDto })
  @ApiOkResponse({
    description: 'Đăng nhập thành công',
    schema: {
      example: {
        statusCode: 200,
        message: 'Login successfully',
        user: { id: 120, email: 'john@example.com', display_name: 'John Doe' },
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) res: Response,
  ) {
    const result = await this.usersService.login(loginDto);

    // Set httpOnly cookies với domain nếu có
    const accessTokenOptions: any = {
      httpOnly: result.cookieOptions.access_token.httpOnly,
      secure: result.cookieOptions.access_token.secure,
      sameSite: result.cookieOptions.access_token.sameSite,
      expires: result.cookieOptions.access_token.expires,
      path: result.cookieOptions.access_token.path,
    };
    if (result.cookieOptions.access_token.domain) {
      accessTokenOptions.domain = result.cookieOptions.access_token.domain;
    }

    const refreshTokenOptions: any = {
      httpOnly: result.cookieOptions.refresh_token.httpOnly,
      secure: result.cookieOptions.refresh_token.secure,
      sameSite: result.cookieOptions.refresh_token.sameSite,
      expires: result.cookieOptions.refresh_token.expires,
      path: result.cookieOptions.refresh_token.path,
    };
    if (result.cookieOptions.refresh_token.domain) {
      refreshTokenOptions.domain = result.cookieOptions.refresh_token.domain;
    }

    // Set cookies directly - Express will overwrite existing cookies with same name
    // KHÔNG clear cookies trước vì sẽ tạo thêm 2 Set-Cookie headers (clear),
    // làm tổng cộng 4 cookies trong 1 header, browser có thể chỉ parse cookie đầu tiên
    res.cookie(
      'access_token',
      result.cookieOptions.access_token.value,
      accessTokenOptions,
    );
    res.cookie(
      'refresh_token',
      result.cookieOptions.refresh_token.value,
      refreshTokenOptions,
    );

    return result.response;
  }

  @Post('refresh-token')
  @ApiOperation({ summary: 'Làm mới token từ cookie refresh_token' })
  @ApiOkResponse({
    description: 'Làm mới token thành công',
    schema: {
      example: { statusCode: 200, message: 'Refresh token successfully' },
    },
  })
  @HttpCode(HttpStatus.OK)
  async refreshToken(
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    // Get refresh_token from cookie
    const refreshToken = req.cookies?.refresh_token;

    if (!refreshToken) {
      throw new HttpException('Refresh token not found in cookies', 419);
    }

    const result = await this.usersService.refreshToken(refreshToken);

    // Set httpOnly cookies với domain nếu có
    const accessTokenOptions: any = {
      httpOnly: result.cookieOptions.access_token.httpOnly,
      secure: result.cookieOptions.access_token.secure,
      sameSite: result.cookieOptions.access_token.sameSite,
      expires: result.cookieOptions.access_token.expires,
      path: result.cookieOptions.access_token.path,
    };
    if (result.cookieOptions.access_token.domain) {
      accessTokenOptions.domain = result.cookieOptions.access_token.domain;
    }

    const refreshTokenOptions: any = {
      httpOnly: result.cookieOptions.refresh_token.httpOnly,
      secure: result.cookieOptions.refresh_token.secure,
      sameSite: result.cookieOptions.refresh_token.sameSite,
      expires: result.cookieOptions.refresh_token.expires,
      path: result.cookieOptions.refresh_token.path,
    };
    if (result.cookieOptions.refresh_token.domain) {
      refreshTokenOptions.domain = result.cookieOptions.refresh_token.domain;
    }

    // Set cookies using res.cookie() - Express will handle Set-Cookie headers
    res.cookie(
      'access_token',
      result.cookieOptions.access_token.value,
      accessTokenOptions,
    );
    res.cookie(
      'refresh_token',
      result.cookieOptions.refresh_token.value,
      refreshTokenOptions,
    );

    return result.response;
  }

  @Post('generate-code-verify-email')
  @ApiOperation({ summary: 'Gửi mã xác thực email cho tài khoản hiện tại' })
  @ApiOkResponse({
    description: 'Gửi mã thành công',
    schema: {
      example: {
        statusCode: 200,
        message: 'Verification code sent successfully',
      },
    },
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async generateCodeVerifyEmail(@Request() req: any) {
    const user = req.user; // User from JWT token
    const result = await this.usersService.generateCodeVerifyEmail(user.uid);
    return {
      statusCode: HttpStatus.OK,
      message: result.message,
    };
  }

  @Post('verify-email')
  @ApiOperation({ summary: 'Xác thực email bằng mã OTP' })
  @ApiBody({ type: VerifyEmailDto })
  @ApiOkResponse({
    description: 'Xác thực email thành công',
    schema: {
      example: {
        statusCode: 200,
        message: 'Email verified successfully',
        user: {
          id: 120,
          name: 'john_doe',
          email: 'john@example.com',
          active_email: true,
        },
      },
    },
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async verifyEmail(
    @Body() verifyEmailDto: VerifyEmailDto,
    @Request() req: any,
  ) {
    const user = req.user; // User from JWT token
    const verifiedUser = await this.usersService.verifyEmail(
      user.uid,
      verifyEmailDto.code,
    );

    return {
      statusCode: HttpStatus.OK,
      message: 'Email verified successfully',
      user: {
        id: verifiedUser.uid,
        name: verifiedUser.uname,
        email: verifiedUser.uemail,
        active_email: verifiedUser.u_active_email,
      },
    };
  }

  @Get('me')
  @ApiOperation({ summary: 'Lấy thông tin tài khoản hiện tại' })
  @ApiOkResponse({
    description: 'Lấy profile thành công',
    schema: {
      example: {
        statusCode: 200,
        user: {
          uid: 120,
          uname: 'john_doe',
          uemail: 'john@example.com',
          udisplay_name: 'John Doe',
        },
      },
    },
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getCurrentUser(@Request() req: any) {
    const user = req.user; // User from JWT token
    const userInfo = await this.usersService.getCurrentUser(user.uid);

    return {
      statusCode: HttpStatus.OK,
      user: userInfo,
    };
  }

  @Get('kyc-status')
  @ApiOperation({ summary: 'Lấy trạng thái KYC của người dùng' })
  @ApiOkResponse({
    description: 'Trạng thái KYC hiện tại',
    schema: { example: { statusCode: 200, status: 'pending' } },
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getKycStatus(@Request() req: any) {
    const user = req.user; // User from JWT token
    const result = await this.usersService.getKycStatus(user.uid);

    const response: any = {
      statusCode: HttpStatus.OK,
      status: result.status,
    };

    // Add notes if status is retry
    if (result.status === 'retry' && result.notes) {
      response.notes = result.notes;
    }

    return response;
  }

  @Get('check-register-kol')
  @ApiOperation({ summary: 'Kiểm tra user đã đăng ký KOL hay chưa' })
  @ApiOkResponse({
    description: 'Trạng thái đăng ký KOL',
    schema: { example: { statusCode: 200, status: 'not_registered' } },
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async checkRegisterKol(@Request() req: any) {
    const user = req.user; // User from JWT token
    const result = await this.usersService.checkRegisterKol(user.uid);

    return {
      statusCode: HttpStatus.OK,
      status: result.status,
    };
  }

  @Post('kyc')
  @ApiOperation({ summary: 'Gửi hồ sơ KYC lần đầu (kèm 2 ảnh)' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        idCardNumber: { type: 'string', example: '079123456789' },
        images: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          minItems: 2,
          maxItems: 2,
        },
      },
      required: ['idCardNumber', 'images'],
    },
  })
  @ApiCreatedResponse({
    description: 'Gửi KYC thành công',
    schema: {
      example: {
        statusCode: 201,
        message: 'Submit KYC successfully',
        data: { status: 'pending' },
      },
    },
  })
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FilesInterceptor('images', 2, multerConfig))
  @HttpCode(HttpStatus.CREATED)
  async submitKyc(
    @Request() req: any,
    @Body() kycDto: KycDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const user = req.user; // User from JWT token
    const result = await this.usersService.submitKyc(user.uid, kycDto, files);
    return result.response;
  }

  @Post('kyc-retry')
  @ApiOperation({ summary: 'Gửi lại hồ sơ KYC sau khi bị yêu cầu retry' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        idCardNumber: { type: 'string', example: '079123456789' },
        images: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          minItems: 2,
          maxItems: 2,
        },
      },
      required: ['idCardNumber', 'images'],
    },
  })
  @ApiOkResponse({
    description: 'Gửi lại KYC thành công',
    schema: {
      example: {
        statusCode: 200,
        message: 'Retry KYC successfully',
        data: { status: 'pending' },
      },
    },
  })
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FilesInterceptor('images', 2, multerConfig))
  @HttpCode(HttpStatus.OK)
  async retryKyc(
    @Request() req: any,
    @Body() kycDto: KycDto,
    @UploadedFiles() files: Express.Multer.File[],
  ) {
    const user = req.user; // User from JWT token
    const result = await this.usersService.retryKyc(user.uid, kycDto, files);
    return result.response;
  }

  @Get('check-code')
  @ApiOperation({ summary: 'Kiểm tra mã referral/code hợp lệ' })
  @ApiQuery({ name: 'code', required: true, example: 'REF2026' })
  @ApiOkResponse({
    description: 'Mã hợp lệ',
    schema: {
      example: { statusCode: 200, message: 'Code is valid', valid: true },
    },
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async checkCode(@Request() req: any, @Query('code') code: string) {
    const user = req.user; // User from JWT token
    const result = await this.usersService.checkCode(user.uid, code);
    return result;
  }

  @Post('reset-password')
  @ApiOperation({ summary: 'Gửi yêu cầu đặt lại mật khẩu qua email' })
  @ApiBody({ type: ResetPasswordDto })
  @ApiOkResponse({
    description: 'Yêu cầu reset thành công',
    schema: {
      example: {
        statusCode: 200,
        message: 'Reset password code sent to email',
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  async resetPassword(@Body() resetPasswordDto: ResetPasswordDto) {
    const result = await this.usersService.resetPassword(resetPasswordDto);
    return result;
  }

  @Post('set-new-password')
  @ApiOperation({ summary: 'Đặt mật khẩu mới từ mã reset' })
  @ApiBody({ type: SetNewPasswordDto })
  @ApiOkResponse({
    description: 'Đặt mật khẩu mới thành công',
    schema: {
      example: { statusCode: 200, message: 'Set new password successfully' },
    },
  })
  @HttpCode(HttpStatus.OK)
  async setNewPassword(@Body() setNewPasswordDto: SetNewPasswordDto) {
    const result = await this.usersService.setNewPassword(setNewPasswordDto);
    return result;
  }

  @Post('change-password')
  @ApiOperation({ summary: 'Đổi mật khẩu khi đã đăng nhập' })
  @ApiBody({ type: ChangePasswordDto })
  @ApiOkResponse({
    description: 'Đổi mật khẩu thành công',
    schema: {
      example: { statusCode: 200, message: 'Change password successfully' },
    },
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async changePassword(
    @Request() req: any,
    @Body() changePasswordDto: ChangePasswordDto,
  ) {
    const user = req.user; // User from JWT token
    const result = await this.usersService.changePassword(
      user.uid,
      changePasswordDto,
    );
    return result;
  }

  @Post('update-profile')
  @ApiOperation({ summary: 'Cập nhật thông tin profile người dùng' })
  @ApiBody({ type: UpdateProfileDto })
  @ApiOkResponse({
    description: 'Cập nhật profile thành công',
    schema: {
      example: { statusCode: 200, message: 'Update profile successfully' },
    },
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async updateProfile(
    @Request() req: any,
    @Body() updateProfileDto: UpdateProfileDto,
  ) {
    const user = req.user; // User from JWT token
    const result = await this.usersService.updateProfile(
      user.uid,
      updateProfileDto,
    );
    return result;
  }

  @Post('register-kol')
  @ApiOperation({ summary: 'Đăng ký làm KOL' })
  @ApiBody({ type: RegisterKolDto })
  @ApiCreatedResponse({
    description: 'Đăng ký KOL thành công',
    schema: {
      example: { statusCode: 201, message: 'Register KOL successfully' },
    },
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async registerKol(
    @Request() req: any,
    @Body() registerKolDto: RegisterKolDto,
  ) {
    const user = req.user; // User from JWT token
    const result = await this.usersService.registerKol(
      user.uid,
      registerKolDto,
    );
    return result.response;
  }

  @Post('submit-kol-article')
  @ApiOperation({ summary: 'Gửi bài viết KOL để xét duyệt' })
  @ApiBody({ type: SubmitKolArticleDto })
  @ApiCreatedResponse({
    description: 'Gửi bài viết thành công',
    schema: {
      example: { statusCode: 201, message: 'Submit article successfully' },
    },
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  async submitKolArticle(
    @Request() req: any,
    @Body() submitKolArticleDto: SubmitKolArticleDto,
  ) {
    const user = req.user; // User from JWT token
    const result = await this.usersService.submitKolArticle(
      user.uid,
      submitKolArticleDto,
    );
    return result.response;
  }

  @Get('kol-articles')
  @ApiOperation({ summary: 'Lấy danh sách bài viết KOL của user' })
  @ApiQuery({ name: 'status', required: false, example: 'approved' })
  @ApiOkResponse({
    description: 'Danh sách bài viết KOL',
    schema: {
      example: {
        statusCode: 200,
        message: 'Get kol articles successfully',
        data: [
          {
            id: 9,
            article_url: 'https://medium.com/@john/article',
            status: 'approved',
          },
        ],
      },
    },
  })
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getUserKolArticles(
    @Request() req: any,
    @Query('status') status?: string,
  ) {
    const user = req.user; // User from JWT token
    const result = await this.usersService.getUserKolArticles(user.uid, status);
    return result;
  }

  @Post('logout')
  @ApiOperation({ summary: 'Đăng xuất và clear cookie token' })
  @ApiOkResponse({
    description: 'Đăng xuất thành công',
    schema: { example: { statusCode: 200, message: 'Logout successful' } },
  })
  @HttpCode(HttpStatus.OK)
  async logout(@Request() req: any, @Res({ passthrough: true }) res: Response) {
    // Get user from request if authenticated (optional)
    const user = req.user || null;
    const userId = user?.uid || null;

    // Get IP address and user agent
    const ipAddress = req.ip || req.connection?.remoteAddress || null;
    const userAgent = req.headers?.['user-agent'] || null;

    // Call logout service
    const result = await this.usersService.logout(userId, ipAddress, userAgent);

    // Clear cookies by setting them to expire in the past
    res.cookie('access_token', '', {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      expires: new Date(0),
      path: '/',
    });

    res.cookie('refresh_token', '', {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      expires: new Date(0),
      path: '/',
    });

    return result;
  }

  @Get('total')
  @ApiOperation({ summary: 'Lấy tổng số lượng user' })
  @ApiOkResponse({
    description: 'Tổng số lượng user',
    schema: {
      example: {
        statusCode: 200,
        message: 'Get total users successfully',
        data: { total_users: 15230 },
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  async getTotalUsers() {
    const total = await this.usersService.getTotalUsers();

    return {
      statusCode: HttpStatus.OK,
      message: 'Get total users successfully',
      data: {
        total_users: total,
      },
    };
  }
}
