import { ApiProperty } from '@nestjs/swagger';
import { IsIn } from 'class-validator';

export class ReviewUserLevelupDto {
  @ApiProperty({
    enum: ['approve', 'reject'],
    example: 'approve',
    description: 'Admin decision for level-up request',
  })
  @IsIn(['approve', 'reject'], {
    message: 'action must be either approve or reject',
  })
  action: 'approve' | 'reject';
}
