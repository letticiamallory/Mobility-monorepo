import { Transform } from 'class-transformer';
import { IsEmail, Length, Matches } from 'class-validator';

export class VerifyEmailDto {
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  email!: string;

  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @Length(6, 6)
  @Matches(/^\d{6}$/)
  code!: string;
}
