import { IsNotEmpty, IsString } from 'class-validator';

export class RegisterFcmDto {
  @IsString()
  @IsNotEmpty()
  token!: string;
}
