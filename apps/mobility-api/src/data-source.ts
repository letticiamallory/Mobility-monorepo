import { join } from 'path';
import { DataSource } from 'typeorm';
import { PhotoCache } from './cache/photo-cache.entity';

export default new DataSource({
  type: 'postgres',
  host: process.env.DATABASE_HOST ?? 'localhost',
  port: parseInt(process.env.DATABASE_PORT ?? '5432', 10),
  username: process.env.DATABASE_USER ?? 'postgres',
  password: process.env.DATABASE_PASSWORD ?? 'postgres123',
  database: process.env.DATABASE_NAME ?? 'Mobility',
  entities: [PhotoCache],
  migrations: [join(__dirname, 'migrations', '*.{ts,js}')],
});
