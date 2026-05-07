import { IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class SendTestPushDto {
  @IsString()
  @IsNotEmpty()
  token!: string;

  @IsOptional()
  @IsString()
  title?: string;

  @IsOptional()
  @IsString()
  body?: string;
}
