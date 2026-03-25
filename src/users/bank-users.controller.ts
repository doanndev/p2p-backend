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
import { UpdateBankUserDto } from './dto/update-bank-user.dto';

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

  @Put(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cập nhật bank của user' })
  @ApiParam({ name: 'id', example: '1' })
  @ApiBody({ type: UpdateBankUserDto })
  updateMyBank(
    @Request() req: any,
    @Param('id') id: string,
    @Body() dto: UpdateBankUserDto,
  ) {
    return this.bankUsersService.updateMyBank(req.user.uid, Number(id), dto);
  }

  @Delete(':id')
  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Xóa bank của user' })
  @ApiParam({ name: 'id', example: '1' })
  @ApiOkResponse({
    schema: { example: { message: 'Bank deleted successfully' } },
  })
  deleteMyBank(@Request() req: any, @Param('id') id: string) {
    return this.bankUsersService.deleteMyBank(req.user.uid, Number(id));
  }
}

