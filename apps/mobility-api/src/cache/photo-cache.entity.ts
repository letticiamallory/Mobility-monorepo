import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
} from 'typeorm';

@Entity('photo_cache')
export class PhotoCache {
  @PrimaryGeneratedColumn()
  id: number;

  @Column({ unique: true })
  cache_key: string;

  @Column({ type: 'text' })
  photo_url: string;

  /** JSON.stringify(string[]) — várias fotos do mesmo trecho (ex.: 3 Street Views em caminhada). */
  @Column({ type: 'text', nullable: true })
  urls_json: string | null;

  @Column({ nullable: true })
  source: string;

  @CreateDateColumn()
  created_at: Date;

  @Column({ type: 'timestamp', nullable: true })
  expires_at: Date | null;
}
