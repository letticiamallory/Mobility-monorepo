import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('routes')
export class Routes {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  user_id: number;

  @Column()
  origin: string;

  @Column()
  destination: string;

  /** Rótulo curto (ex.: main_text do Places) para listas; endereço completo fica em `origin` / `destination`. */
  @Column({ name: 'origin_title', type: 'varchar', length: 500, nullable: true })
  originTitle!: string | null;

  @Column({ name: 'destination_title', type: 'varchar', length: 500, nullable: true })
  destinationTitle!: string | null;

  /** Endereço completo usado no planejamento (pode coincidir com `origin` / `destination`). */
  @Column({ name: 'origin_address', type: 'varchar', length: 1000, nullable: true })
  originAddress!: string | null;

  @Column({ name: 'destination_address', type: 'varchar', length: 1000, nullable: true })
  destinationAddress!: string | null;

  @Column()
  transport_type: string;

  @Column({ default: 'companied' })
  accompanied: string;

  @Column({ default: true })
  accessible: boolean;

  @CreateDateColumn()
  created_at: Date;
}
