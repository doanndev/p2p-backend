import { IsOptional, IsNumber, IsArray, Min, Max, ArrayMinSize, ValidateIf, IsString } from 'class-validator';

export class SmartRefLevelSettingsDto {
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(7)
  maxLevel?: number;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ValidateIf((o) => o.percentage !== undefined)
  @IsNumber({}, { each: true })
  percentage?: number[];

  @IsOptional()
  @IsString()
  logIpAddress?: string;
}

