import { IsOptional, IsNumber, IsArray, Min, Max, ArrayMinSize, ValidateIf, IsString } from 'class-validator';

export class SmartRefLevelSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(7)
  max_level?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateIf((o) => o.parcentage !== undefined)
  @IsNumber({}, { each: true })
  parcentage?: number[];

  @IsOptional()
  @IsString()
  log_ip_address?: string;
}

