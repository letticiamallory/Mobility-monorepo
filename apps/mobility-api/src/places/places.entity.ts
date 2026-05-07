import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
} from 'typeorm';

@Entity('places')
export class Places {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  type: string;

  @Column()
  city: string;

  @Column()
  address: string;

  @Column()
  accessible: boolean;

  @Column()
  disability_type: string;

  @Column({ nullable: true })
  observation: string;

  @CreateDateColumn()
  created_at: Date;
}
