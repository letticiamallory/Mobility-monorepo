import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * A entidade {@link Routes} e o repositório TypeORM assumem esta coluna.
 * Sem ela, INSERTs com fallback raw podem funcionar, mas SELECTs (histórico) falham.
 */
export class AddAccompaniedToRoutes1750000000000 implements MigrationInterface {
  name = 'AddAccompaniedToRoutes1750000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "routes"
      ADD COLUMN IF NOT EXISTS "accompanied" character varying NOT NULL DEFAULT 'companied'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "routes"
      DROP COLUMN IF EXISTS "accompanied"
    `);
  }
}
