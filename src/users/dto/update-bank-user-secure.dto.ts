import { IntersectionType } from '@nestjs/swagger';
import { UpdateBankUserDto } from './update-bank-user.dto';
import { BankMutationSecurityDto } from './bank-mutation-security.dto';

export class UpdateBankUserSecureDto extends IntersectionType(
  UpdateBankUserDto,
  BankMutationSecurityDto,
) {}
