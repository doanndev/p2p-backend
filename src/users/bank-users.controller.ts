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
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { BankUsersService } from './bank-users.service';
import { CreateBankUserDto } from './dto/create-bank-user.dto';
import { RequestBankMutationVerifyCodeDto } from './dto/request-bank-mutation-verify-code.dto';
import { UpdateBankUserSecureDto } from './dto/update-bank-user-secure.dto';
import { BankMutationSecurityDto } from './dto/bank-mutation-security.dto';

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
  @ApiOperation({ summary: 'Tạo bank cho user (tối đa 5 bank/user)' })
  @ApiBody({ type: CreateBankUserDto })
  createMyBank(@Request() req: any, @Body() dto: CreateBankUserDto) {
    return this.bankUsersService.createMyBank(req.user.uid, dto);
  }

  @Post('verify-code')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gửi email verification code cho thao tác update/delete bank',
  })
  @ApiBody({ type: RequestBankMutationVerifyCodeDto, required: false })
  requestBankMutationVerifyCode(
    @Request() req: any,
    @Body() _dto: RequestBankMutationVerifyCodeDto,
  ) {
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
    return this.bankUsersService.updateMyBankSecure(req.user.uid, Number(id), dto);
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
    return this.bankUsersService.deleteMyBankSecure(req.user.uid, Number(id), dto);
  }
}

