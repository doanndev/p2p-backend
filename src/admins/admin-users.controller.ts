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
import { AdminsUsersOpsService } from './admins-users-ops.service';
import { AdminJwtAuthGuard } from './guards/admin-jwt-auth.guard';
import { AdminPermissionReadUsersGuard } from './guards/admin-permission-read-users.guard';
import { AdminPermissionAdvancedUsersGuard } from './guards/admin-permission-advanced-users.guard';
import { UpdateUserStatusDto } from './dto/update-user-status.dto';
import { UpdateKolDto } from './dto/update-kol.dto';
import { UpdateKolArticleStatusDto } from './dto/update-kol-article-status.dto';
import { ReviewUserLevelupDto } from './dto/review-user-levelup.dto';
import { QueryBankUsersDto } from './dto/query-bank-users.dto';
import {
  ApiBody,
  ApiCookieAuth,
  ApiOkResponse,
  ApiOperation,
  ApiTags,
  ApiQuery,
} from '@nestjs/swagger';

@ApiTags('Admin Users')
@ApiCookieAuth('admin_access_token')
@Controller('admins/users')
export class AdminUsersController {
  constructor(private readonly adminsUsersOpsService: AdminsUsersOpsService) {}

  @Get()
  @ApiOperation({ summary: 'Danh sách user phân trang' })
  @ApiOkResponse({
    description: 'Danh sách user',
    schema: {
      example: {
        statusCode: 200,
        data: [{ uid: 120, uname: 'john_doe', uemail: 'john@example.com' }],
        meta: { page: 1, limit: 30, total: 500 },
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionReadUsersGuard)
  @HttpCode(HttpStatus.OK)
  async getUsers(
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sort_by')
    sortBy?:
      | 'created_at'
      | 'total_transactions'
      | 'executed_transactions'
      | 'total_deposit'
      | 'total_withdraw',
    @Query('sort_order') sortOrder?: 'asc' | 'desc' | 'ASC' | 'DESC',
  ) {
    const normalizedSortOrder = (sortOrder || 'DESC').toUpperCase();
    const result = await this.adminsUsersOpsService.getUsersPaginated(
      page ? parseInt(page, 10) || 1 : 1,
      limit ? parseInt(limit, 10) || 30 : 30,
      sortBy || 'created_at',
      normalizedSortOrder === 'ASC' ? 'ASC' : 'DESC',
    );
    return result;
  }

  /** Static path must be registered before `@Get(':id')` or Nest matches `need-levelup` as an id. */
  @Get('need-levelup')
  @ApiOperation({ summary: 'Danh sách user đang chờ duyệt level-up' })
  @ApiOkResponse({
    description: 'Danh sách user need_levelup=true',
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionReadUsersGuard)
  @HttpCode(HttpStatus.OK)
  async getUsersNeedLevelUp() {
    return this.adminsUsersOpsService.getUsersNeedLevelUp();
  }

  @Get('kols-register')
  @ApiOperation({ summary: 'Danh sách hồ sơ đăng ký KOL' })
  @ApiOkResponse({
    description: 'Danh sách hồ sơ KOL',
    schema: {
      example: {
        statusCode: 200,
        data: [{ user_id: 120, name: 'John KOL', status: 'pending' }],
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionReadUsersGuard)
  @HttpCode(HttpStatus.OK)
  async getKolRegisters(@Query('status') status?: string) {
    const result = await this.adminsUsersOpsService.getKolRegisters(status);
    return result;
  }

  @Get('kol-articles')
  @ApiOperation({ summary: 'Danh sách bài viết KOL' })
  @ApiOkResponse({
    description: 'Danh sách bài viết KOL',
    schema: {
      example: {
        statusCode: 200,
        data: [
          {
            id: 9,
            user_id: 120,
            article_url: 'https://medium.com/@john/article',
            status: 'approved',
          },
        ],
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionReadUsersGuard)
  @HttpCode(HttpStatus.OK)
  async getKolArticles(
    @Query('status') status?: string,
    @Query('user_id') userId?: string,
  ) {
    const userIdNumber = userId ? parseInt(userId, 10) : undefined;
    const result = await this.adminsUsersOpsService.getKolArticles(
      status,
      userIdNumber,
    );
    return result;
  }

  @Get('bank-users')
  @ApiOperation({ summary: 'Danh sách bank user phân trang (với filter)' })
  @ApiQuery({
    name: 'page',
    required: false,
    example: 1,
    description: 'Trang (mặc định 1)',
  })
  @ApiQuery({
    name: 'limit',
    required: false,
    example: 20,
    description: 'Số lượng item mỗi trang (mặc định 20, tối đa 100)',
  })
  @ApiQuery({
    name: 'userName',
    required: false,
    example: 'john_doe',
    description: 'Tìm kiếm theo username hoặc full name',
  })
  @ApiQuery({
    name: 'bankName',
    required: false,
    example: 'Agribank',
    description: 'Tìm kiếm theo tên ngân hàng',
  })
  @ApiQuery({
    name: 'bankAccountNumber',
    required: false,
    example: '1234567890',
    description: 'Tìm kiếm theo số tài khoản ngân hàng',
  })
  @ApiQuery({
    name: 'bankAccountName',
    required: false,
    example: 'Nguyễn Văn A',
    description: 'Tìm kiếm theo tên chủ tài khoản',
  })
  @ApiQuery({
    name: 'sortBy',
    required: false,
    enum: ['created_at', 'username', 'bank_name'],
    example: 'created_at',
    description: 'Cột sắp xếp',
  })
  @ApiQuery({
    name: 'sortOrder',
    required: false,
    enum: ['ASC', 'DESC'],
    example: 'DESC',
    description: 'Hướng sắp xếp',
  })
  @ApiOkResponse({
    description: 'Danh sách bank user',
    schema: {
      example: {
        statusCode: 200,
        data: [
          {
            uid: 120,
            uname: 'john_doe',
            email: 'john@example.com',
            phone: '0912345678',
            display_name: 'Nguyễn Văn John',
            bu_id: 5,
            bu_bank_name: 'Agribank',
            bu_passbook_image_url:
              'https://res.cloudinary.com/demo/image/upload/v1/passbook.jpg',
            bu_bank_account_name: 'Nguyễn Văn John',
            bu_bank_account_number: '1234567890',
            created_at: '2024-01-15T10:30:00Z',
            updated_at: '2024-01-15T10:30:00Z',
          },
        ],
        meta: { page: 1, limit: 20, total: 50, total_pages: 3 },
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionReadUsersGuard)
  @HttpCode(HttpStatus.OK)
  async getBankUsers(@Query() queryDto: QueryBankUsersDto) {
    const result = await this.adminsUsersOpsService.getBankUsersPaginated(
      queryDto.page || 1,
      queryDto.limit || 20,
      queryDto.sortBy || 'created_at',
      queryDto.sortOrder || 'DESC',
      queryDto.userName,
      queryDto.bankName,
      queryDto.bankAccountNumber,
      queryDto.bankAccountName,
    );
    return result;
  }

  @Get(':id')
  @ApiOperation({ summary: 'Chi tiết user theo id' })
  @ApiOkResponse({
    description: 'Chi tiết user',
    schema: {
      example: {
        statusCode: 200,
        data: {
          uid: 120,
          uname: 'john_doe',
          uemail: 'john@example.com',
          status: 'active',
        },
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionReadUsersGuard)
  @HttpCode(HttpStatus.OK)
  async getUserById(@Param('id') id: string) {
    const uid = parseInt(id, 10);
    const result = await this.adminsUsersOpsService.getUserById(uid);
    return result;
  }

  @Post(':id/update-kol')
  @ApiOperation({ summary: 'Duyệt hoặc từ chối hồ sơ KOL của user' })
  @ApiBody({ type: UpdateKolDto })
  @ApiOkResponse({
    description: 'Cập nhật trạng thái KOL thành công',
    schema: {
      example: { statusCode: 200, message: 'Update KOL status successfully' },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionAdvancedUsersGuard)
  @HttpCode(HttpStatus.OK)
  async toggleUserKol(
    @Param('id') id: string,
    @Body() updateKolDto: UpdateKolDto,
  ) {
    const uid = parseInt(id, 10);
    const result = await this.adminsUsersOpsService.toggleUserKol(
      uid,
      updateKolDto.status,
    );
    return result;
  }

  @Post(':id/update-status')
  @ApiOperation({
    summary: 'Cập nhật trạng thái tài khoản user',
    description:
      '`block_trade`: hủy mọi transaction pending của user, đóng (FAILED) orderbook pending của user, rồi đặt status. `payment_confirmed` không bị hủy — user vẫn có thể gọi confirm-received để kết thúc.',
  })
  @ApiBody({ type: UpdateUserStatusDto })
  @ApiOkResponse({
    description: 'Cập nhật trạng thái user thành công',
    schema: {
      example: { statusCode: 200, message: 'Update user status successfully' },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionAdvancedUsersGuard)
  @HttpCode(HttpStatus.OK)
  async updateUserStatus(
    @Param('id') id: string,
    @Body() updateUserStatusDto: UpdateUserStatusDto,
    @Request() req: any,
  ) {
    const uid = parseInt(id, 10);
    const admin = req.user;
    const result = await this.adminsUsersOpsService.updateUserStatus(
      uid,
      updateUserStatusDto.status,
      admin.admin_id,
    );
    return result;
  }

  @Post(':id/review-levelup')
  @ApiOperation({ summary: 'Duyệt hoặc từ chối level-up cho user' })
  @ApiBody({ type: ReviewUserLevelupDto })
  @ApiOkResponse({
    description: 'Kết quả duyệt level-up',
    schema: {
      example: {
        statusCode: 200,
        message: 'User level-up approved successfully',
        data: { uid: 12, level: 4, need_levelup: false, action: 'approve' },
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionAdvancedUsersGuard)
  @HttpCode(HttpStatus.OK)
  async reviewUserLevelup(
    @Param('id') id: string,
    @Body() dto: ReviewUserLevelupDto,
    @Request() req: any,
  ) {
    const uid = parseInt(id, 10);
    const admin = req.user;
    return this.adminsUsersOpsService.reviewUserLevelUp(
      uid,
      dto.action,
      admin.admin_id,
    );
  }

  @Post('kol-articles/:id/update-status')
  @ApiOperation({ summary: 'Cập nhật trạng thái bài viết KOL' })
  @ApiBody({ type: UpdateKolArticleStatusDto })
  @ApiOkResponse({
    description: 'Cập nhật trạng thái bài viết thành công',
    schema: {
      example: {
        statusCode: 200,
        message: 'Update KOL article status successfully',
      },
    },
  })
  @UseGuards(AdminJwtAuthGuard, AdminPermissionAdvancedUsersGuard)
  @HttpCode(HttpStatus.OK)
  async updateKolArticleStatus(
    @Param('id') id: string,
    @Body() updateKolArticleStatusDto: UpdateKolArticleStatusDto,
    @Request() req: any,
  ) {
    const articleId = parseInt(id, 10);
    const admin = req.user;
    const result = await this.adminsUsersOpsService.updateKolArticleStatus(
      articleId,
      updateKolArticleStatusDto.status,
      admin.admin_id,
    );
    return result;
  }
}
