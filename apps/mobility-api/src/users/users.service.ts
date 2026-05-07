import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { User } from './users.entity';
import { DisabilityType } from '../users/users.entity';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateMeDto } from './dto/update-me.dto';
import { AuthService } from '../auth/auth.service';
import {
  avatarToDataUrl,
  parseOptionalAvatarPayload,
} from './utils/avatar-payload.util';

/*O injectable é o que diz pro nest.js que a nossa classe pode ser injetada em outras classes
caso contrario, nossa controller não conseguiria usar a nossa service. */
@Injectable()
export class UsersService {
  private hasAccompaniedColumn: boolean | null = null;

  constructor(
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private authService: AuthService,
  ) {}

  async newUser(dto: CreateUserDto): Promise<{ message: string }> {
    return this.authService.register(dto);
  }

  async getUserById(id: number): Promise<User> {
    const user = await this.usersRepository.findOne({ where: { id } });

    if (!user) {
      throw new NotFoundException(`Usuário com id ${id} não encontrado`);
    }

    return user;
  }

  async getMeById(id: number): Promise<{
    id: number;
    name: string;
    email: string;
    disability_type: DisabilityType;
    accompanied: string;
    phone: string | null;
    birth_date: string | null;
    avatar_data_url: string | null;
  }> {
    if (await this.usersTableHasAccompaniedColumn()) {
      const user = await this.usersRepository.findOne({ where: { id } });

      if (!user) {
        throw new NotFoundException(`Usuário com id ${id} não encontrado`);
      }

      return {
        id: user.id,
        name: user.name,
        email: user.email,
        disability_type: user.disability_type,
        accompanied: user.accompanied ?? 'companied',
        phone: user.phone ?? null,
        birth_date: user.birth_date ?? null,
        avatar_data_url: avatarToDataUrl(user.avatar_mime, user.avatar_data),
      };
    }

    const rows = (await this.usersRepository.query(
      `SELECT id, name, email, disability_type, phone, birth_date, avatar_mime, avatar_data
       FROM users
       WHERE id = $1
       LIMIT 1`,
      [id],
    )) as Array<{
      id: number;
      name: string;
      email: string;
      disability_type: DisabilityType;
      phone: string | null;
      birth_date: string | null;
      avatar_mime: string | null;
      avatar_data: Buffer | null;
    }>;

    if (rows.length === 0) {
      throw new NotFoundException(`Usuário com id ${id} não encontrado`);
    }

    const user = rows[0];

    return {
      id: user.id,
      name: user.name,
      email: user.email,
      disability_type: user.disability_type,
      accompanied: 'companied',
      phone: user.phone ?? null,
      birth_date: user.birth_date ?? null,
      avatar_data_url: avatarToDataUrl(user.avatar_mime, user.avatar_data),
    };
  }

  async updateFcmToken(id: number, token: string): Promise<void> {
    await this.usersRepository.update(id, { fcm_token: token });
  }

  async updateMeById(
    id: number,
    dto: UpdateMeDto,
  ): Promise<{
    id: number;
    name: string;
    email: string;
    disability_type: DisabilityType;
    accompanied: string;
    phone: string | null;
    birth_date: string | null;
    avatar_data_url: string | null;
  }> {
    const user = await this.usersRepository.findOne({ where: { id } });
    if (!user) {
      throw new NotFoundException(`Usuário com id ${id} não encontrado`);
    }

    if (dto.name !== undefined) {
      const name = dto.name.trim();
      if (name.length < 2) {
        throw new BadRequestException('Nome deve ter pelo menos 2 caracteres');
      }
      user.name = name;
    }

    if (dto.phone !== undefined) {
      const p = dto.phone.replace(/\u00A0/g, ' ').trim();
      user.phone = p.length > 0 ? p.slice(0, 32) : null;
    }

    if (dto.birth_date !== undefined) {
      const b = dto.birth_date.trim();
      user.birth_date = b.length > 0 ? b : null;
    }

    if (dto.disability_type !== undefined) {
      user.disability_type = dto.disability_type as DisabilityType;
    }

    if (dto.accompanied !== undefined && (await this.usersTableHasAccompaniedColumn())) {
      user.accompanied = dto.accompanied;
    }

    if (dto.avatar_base64 !== undefined) {
      const s = dto.avatar_base64.trim();
      if (s.length === 0) {
        user.avatar_data = null;
        user.avatar_mime = null;
      } else {
        const parsed = parseOptionalAvatarPayload(s, dto.avatar_mime ?? null);
        if (parsed) {
          user.avatar_data = parsed.buffer;
          user.avatar_mime = parsed.mime;
        }
      }
    }

    const saved = await this.usersRepository.save(user);
    return {
      id: saved.id,
      name: saved.name,
      email: saved.email,
      disability_type: saved.disability_type,
      accompanied: saved.accompanied ?? 'companied',
      phone: saved.phone ?? null,
      birth_date: saved.birth_date ?? null,
      avatar_data_url: avatarToDataUrl(saved.avatar_mime, saved.avatar_data),
    };
  }

  private async usersTableHasAccompaniedColumn(): Promise<boolean> {
    if (this.hasAccompaniedColumn === true) {
      return true;
    }

    try {
      const rows = await this.usersRepository.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'users'
           AND column_name = 'accompanied'
         LIMIT 1`,
      );
      this.hasAccompaniedColumn = rows.length > 0;
    } catch (error) {
      if (error instanceof QueryFailedError) {
        this.hasAccompaniedColumn = false;
        return false;
      }
      this.hasAccompaniedColumn = false;
    }

    return this.hasAccompaniedColumn;
  }
}
