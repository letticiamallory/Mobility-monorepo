import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';
import { Exclude } from 'class-transformer';

export enum DisabilityType {
  VISUAL = 'visual',
  WHEELCHAIR = 'wheelchair',
  REDUCED_MOBILITY = 'reduced_mobility',
}

@Entity('users')
export class User {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column()
  name!: string;

  @Column()
  email!: string;

  @Column()
  @Exclude()
  password!: string;

  @Column({ type: 'enum', enum: DisabilityType })
  disability_type!: DisabilityType;

  /** Telefone opcional; preenchido em Minhas informações no app. */
  @Column({ type: 'varchar', length: 32, nullable: true })
  phone!: string | null;

  /** Data de nascimento no formato YYYY-MM-DD; opcional. */
  @Column({ type: 'varchar', length: 10, nullable: true })
  birth_date!: string | null;

  @Column({ type: 'varchar', length: 32, nullable: true })
  accompanied!: string | null;

  @Column({ type: 'varchar', nullable: true })
  fcm_token!: string | null;

  @Column({ type: 'varchar', nullable: true })
  google_id!: string | null;

  /** MIME da foto de perfil (ex.: image/jpeg). */
  @Column({ type: 'varchar', length: 64, nullable: true })
  avatar_mime!: string | null;

  /** Bytes da imagem (PostgreSQL bytea). Não serializar em JSON genérico. */
  @Column({ type: 'bytea', nullable: true })
  @Exclude()
  avatar_data!: Buffer | null;

  @Column({ type: 'boolean', default: false })
  email_verified!: boolean;

  @Column({ type: 'varchar', length: 16, nullable: true })
  verification_code!: string | null;

  @Column({ type: 'timestamp', nullable: true })
  verification_code_expires_at!: Date | null;

  @CreateDateColumn()
  created_at!: Date;
}
