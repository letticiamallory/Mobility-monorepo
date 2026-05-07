import { IsBoolean, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CreatePlaceDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsString()
  @IsNotEmpty()
  type!: string;

  @IsString()
  @IsNotEmpty()
  city!: string;

  @IsString()
  @IsNotEmpty()
  address!: string;

  @IsBoolean()
  accessible!: boolean;

  @IsString()
  @IsNotEmpty()
  disability_type!: string;

  @IsOptional()
  @IsString()
  observation?: string;
}
