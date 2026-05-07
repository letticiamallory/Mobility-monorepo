import { Transform } from 'class-transformer';
import { IsIn, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Normaliza ISO ou strings com lixo para YYYY-MM-DD antes da validação. */
function normalizeBirthDateInput({ value }: { value: unknown }): unknown {
  if (value === null || value === undefined) return '';
  if (typeof value !== 'string') return value;
  const s = value.trim();
  if (s === '') return '';
  const ymd = s.match(/^(\d{4}-\d{2}-\d{2})/);
  if (ymd) return ymd[1];
  return s;
}

export class UpdateMeDto {
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  name?: string;

  /** Opcional; caracteres validados de forma leve (máscaras variam por dispositivo). */
  @IsOptional()
  @IsString()
  @MaxLength(32)
  phone?: string;

  /** Aceita vazio para limpar (null). YYYY-MM-DD ou início ISO (ex.: vindo de serialização). */
  @IsOptional()
  @Transform(normalizeBirthDateInput)
  @IsString()
  @Matches(/^(\d{4}-\d{2}-\d{2})?$/, { message: 'Data de nascimento deve ser YYYY-MM-DD ou vazia' })
  birth_date?: string;

  @IsOptional()
  @IsString()
  @IsIn(['visual', 'wheelchair', 'reduced_mobility'])
  disability_type?: string;

  @IsOptional()
  @IsString()
  @IsIn(['alone', 'companied'])
  accompanied?: string;

  /** Base64 ou data URL; string vazia remove a foto do perfil. */
  @IsOptional()
  @IsString()
  @MaxLength(8_000_000)
  avatar_base64?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  avatar_mime?: string;
}
