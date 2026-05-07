import {
  IsEmail,
  IsIn,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateUserDto {
  @IsString()
  @IsNotEmpty()
  name!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(6)
  password!: string;

  @IsString()
  @IsNotEmpty()
  confirm_password!: string;

  @IsOptional()
  @IsString()
  confirmPassword?: string;

  @IsString()
  @IsNotEmpty()
  @IsIn(['visual', 'wheelchair', 'reduced_mobility'])
  disability_type!: string;

  @IsOptional()
  @IsString()
  @IsIn(['alone', 'companied'])
  accompanied?: string;

  /** Base64 cru ou data URL; opcional no cadastro. */
  @IsOptional()
  @IsString()
  @MaxLength(8_000_000)
  avatar_base64?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  avatar_mime?: string;
}
