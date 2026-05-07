import { IsOptional, IsString, IsIn } from 'class-validator';
import { WalletTransferStatus } from '../entities/wallet-transfer.entity';
import { ApiPropertyOptional } from '@nestjs/swagger';

export class TransferRewardsHistoryDto {
  @ApiPropertyOptional({
    enum: ['pending', 'success', 'error'],
    example: 'success',
    description: 'Lọc theo trạng thái chuyển thưởng',
  })
  @IsOptional()
  @IsString()
  @IsIn(['pending', 'success', 'error'])
  status?: WalletTransferStatus; // Filter theo wt_status (pending, success, error)
}
