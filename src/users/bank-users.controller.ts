import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBody,
  ApiCookieAuth,
  ApiCreatedResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BankUsersService } from './bank-users.service';
import { CreateBankUserDto } from './dto/create-bank-user.dto';
import { UpdateBankUserSecureDto } from './dto/update-bank-user-secure.dto';
import { BankMutationSecurityDto } from './dto/bank-mutation-security.dto';
import { AdminJwtAuthGuard } from '../admins/guards/admin-jwt-auth.guard';
import { ReviewCreateBankRequestDto } from './dto/review-create-bank-request.dto';

@ApiTags('BankUser')
@ApiCookieAuth('access_token')
@Controller('bank_user')
export class BankUsersController {
  constructor(private readonly bankUsersService: BankUsersService) {}

  @Get()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Lấy các bank của user hiện tại' })
  getMyBanks(@Request() req: any) {
    return this.bankUsersService.getMyBanks(req.user.uid);
  }

  @Post()
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Tạo request tạo bank cho user (chờ admin duyệt trong 24h)',
  })
  @ApiBody({ type: CreateBankUserDto })
  @ApiCreatedResponse({
    schema: {
      example: {
        message: 'Bank create request submitted and waiting for admin approval',
        requestId: 'bank-create-1714444444444-ab12cd',
        requestedAt: '2026-04-29T13:00:00.000Z',
        expiresInSeconds: 86400,
        bank: {
          bankName: 'Vietcombank',
          bankBranch: 'Hà Nội',
          bankAccountName: 'NGUYEN VAN A',
          bankAccountNumber: '0123456789',
        },
      },
    },
  })
  createMyBank(@Request() req: any, @Body() dto: CreateBankUserDto) {
    return this.bankUsersService.createMyBank(req.user.uid, dto);
  }

  @Get('admin/create-requests')
  @UseGuards(AdminJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Admin lấy danh sách request tạo bank đang chờ duyệt',
  })
  getPendingCreateRequests() {
    return this.bankUsersService.getPendingCreateBankRequests();
  }

  @Put('admin/create-requests/:requestId')
  @UseGuards(AdminJwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Admin duyệt hoặc từ chối request tạo bank' })
  @ApiParam({ name: 'requestId', example: 'bank-create-1714444444444-ab12cd' })
  @ApiBody({ type: ReviewCreateBankRequestDto })
  @ApiOkResponse({
    schema: {
      example: {
        message: 'Create bank request approved',
        requestId: 'bank-create-1714444444444-ab12cd',
        approved: true,
        bankId: 21,
      },
    },
  })
  reviewCreateRequest(
    @Param('requestId') requestId: string,
    @Body() dto: ReviewCreateBankRequestDto,
  ) {
    return this.bankUsersService.reviewCreateBankRequest(
      requestId,
      dto.approve,
    );
  }

  @Post('verify-code')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gửi email verification code cho thao tác update/delete bank',
  })
  requestBankMutationVerifyCode(@Request() req: any) {
    return this.bankUsersService.sendBankMutationVerifyCode(req.user.uid);
  }

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cập nhật bank của user' })
  @ApiParam({ name: 'id', example: '1' })
  @ApiBody({ type: UpdateBankUserSecureDto })
  updateMyBank(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateBankUserSecureDto,
  ) {
    return this.bankUsersService.updateMyBankSecure(
      req.user.uid,
      Number(id),
      dto,
    );
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xóa bank của user' })
  @ApiParam({ name: 'id', example: '1' })
  @ApiBody({ type: BankMutationSecurityDto })
  @ApiOkResponse({
    schema: { example: { message: 'Bank deleted successfully' } },
  })
  deleteMyBank(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: BankMutationSecurityDto,
  ) {
    return this.bankUsersService.deleteMyBankSecure(
      req.user.uid,
      Number(id),
      dto,
    );
  }
}
