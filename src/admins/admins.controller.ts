import {
  Controller,
  Post,
  Get,
  Body,
  HttpCode,
  HttpStatus,
  Res,
  Request,
  Query,
  Param,
  UseGuards,
} from '@nestjs/common';
import { Response } from 'express';
import { AdminsService } from './admins.service';
import { LoginAdminDto } from './dto/login-admin.dto';
import { CreateAdminDto } from './dto/create-admin.dto';
import { AdminJwtAuthGuard } from './guards/admin-jwt-auth.guard';
import { AdminSuperAdminGuard } from './guards/admin-super-admin.guard';
import { AdminPermissionReadUsersGuard } from './guards/admin-permission-read-users.guard';
import { AdminPermissionAdvancedUsersGuard } from './guards/admin-permission-advanced-users.guard';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';

@ApiTags('Admin Auth')
@ApiCookieAuth('admin_access_token')
@Controller('admins')
export class AdminsController {
  constructor(private readonly adminsService: AdminsService) {}

  @Post('login')
  @ApiOperation({ summary: 'Đăng nhập admin và set cookie token' })
  @ApiBody({ type: LoginAdminDto })
  @ApiOkResponse({
    description: 'Đăng nhập admin thành công',
    schema: {
      example: {
        statusCode: 200,
        message: 'Login admin successfully',
        admin: { id: 1, email: 'admin@example.com', level: 'super_admin' },
      },
    },
  })
  @HttpCode(HttpStatus.OK)
  async loginAdmin(
    @Body() loginAdminDto: LoginAdminDto,
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const ipAddress = req.ip || req.connection?.remoteAddress || null;
    const userAgent = req.get('user-agent') || null;

    const result = await this.adminsService.login(
      loginAdminDto,
      ipAddress,
      userAgent,
    );

    // Set httpOnly cookies
    res.cookie('admin_access_token', result.cookieOptions.admin_access_token.value, {
      httpOnly: result.cookieOptions.admin_access_token.httpOnly,
      secure: result.cookieOptions.admin_access_token.secure,
      sameSite: result.cookieOptions.admin_access_token.sameSite,
      expires: result.cookieOptions.admin_access_token.expires,
      path: result.cookieOptions.admin_access_token.path,
    });

    res.cookie('admin_refresh_token', result.cookieOptions.admin_refresh_token.value, {
      httpOnly: result.cookieOptions.admin_refresh_token.httpOnly,
      secure: result.cookieOptions.admin_refresh_token.secure,
      sameSite: result.cookieOptions.admin_refresh_token.sameSite,
      expires: result.cookieOptions.admin_refresh_token.expires,
      path: result.cookieOptions.admin_refresh_token.path,
    });

    return result.response;
  }

  @Post('refresh-token')
  @ApiOperation({ summary: 'Làm mới token admin từ cookie admin_refresh_token' })
  @ApiOkResponse({
    description: 'Làm mới token admin thành công',
    schema: { example: { statusCode: 200, message: 'Refresh token successfully' } },
  })
  @HttpCode(HttpStatus.OK)
  async refreshToken(
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const refreshToken = req.cookies?.admin_refresh_token;
    const ipAddress = req.ip || req.connection?.remoteAddress || null;
    const userAgent = req.get('user-agent') || null;

    const result = await this.adminsService.refreshToken(
      refreshToken,
      ipAddress,
      userAgent,
    );

    // Set httpOnly cookies
    res.cookie('admin_access_token', result.cookieOptions.admin_access_token.value, {
      httpOnly: result.cookieOptions.admin_access_token.httpOnly,
      secure: result.cookieOptions.admin_access_token.secure,
      sameSite: result.cookieOptions.admin_access_token.sameSite,
      expires: result.cookieOptions.admin_access_token.expires,
      path: result.cookieOptions.admin_access_token.path,
    });

    res.cookie('admin_refresh_token', result.cookieOptions.admin_refresh_token.value, {
      httpOnly: result.cookieOptions.admin_refresh_token.httpOnly,
      secure: result.cookieOptions.admin_refresh_token.secure,
      sameSite: result.cookieOptions.admin_refresh_token.sameSite,
      expires: result.cookieOptions.admin_refresh_token.expires,
      path: result.cookieOptions.admin_refresh_token.path,
    });

    return result.response;
  }

  @Post('create-admin')
  @ApiOperation({ summary: 'Tạo tài khoản admin mới (super admin)' })
  @ApiBody({ type: CreateAdminDto })
  @ApiCreatedResponse({
    description: 'Tạo admin thành công',
    schema: {
      example: {
        statusCode: 201,
        message: 'Create admin successfully',
        data: { id: 12, username: 'admin_ops', email: 'ops@example.com', level: 'support' },
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminSuperAdminGuard)
  @HttpCode(HttpStatus.CREATED)
  async createAdmin(@Body() createAdminDto: CreateAdminDto, @Request() req: any) {
    const admin = req.user;
    return await this.adminsService.createAdmin(createAdminDto, admin.admin_id);
  }

  @Get('me')
  @ApiOperation({ summary: 'Lấy thông tin admin hiện tại' })
  @ApiOkResponse({
    description: 'Thông tin admin hiện tại',
    schema: { example: { statusCode: 200, admin: { id: 1, username: 'root_admin', level: 'super_admin' } } },
  })
  @UseGuards(AdminJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getCurrentAdmin(@Request() req: any) {
    const admin = req.user; // Admin from JWT token
    const adminInfo = await this.adminsService.getCurrentAdmin(admin.admin_id);

    return {
      statusCode: HttpStatus.OK,
      admin: adminInfo,
    };
  }

  @Get('my-permissions')
  @ApiOperation({ summary: 'Lấy danh sách quyền của admin hiện tại' })
  @ApiOkResponse({
    description: 'Danh sách quyền admin',
    schema: {
      example: {
        statusCode: 200,
        permissions: ['read_users', 'advanced_users', 'read_coins', 'update_coins'],
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async getMyPermissions(@Request() req: any) {
    return await this.adminsService.getMyPermissions(req.user.admin_id);
  }

  @Post('logout')
  @ApiOperation({ summary: 'Đăng xuất admin và clear cookie' })
  @ApiOkResponse({
    description: 'Đăng xuất admin thành công',
    schema: { example: { statusCode: 200, message: 'Logout successful' } },
  })
  @UseGuards(AdminJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  async logoutAdmin(
    @Request() req: any,
    @Res({ passthrough: true }) res: Response,
  ) {
    const admin = req.user; // Admin from JWT token
    const ipAddress = req.ip || req.connection?.remoteAddress || null;
    const userAgent = req.get('user-agent') || null;

    // Log logout action
    await this.adminsService.logout(admin.admin_id, ipAddress, userAgent);

    // Clear httpOnly cookies
    res.clearCookie('admin_access_token', {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
    });

    res.clearCookie('admin_refresh_token', {
      httpOnly: true,
      secure: true,
      sameSite: 'none',
      path: '/',
    });

    return {
      statusCode: HttpStatus.OK,
      message: 'Logout successful',
    };
  }

}

