import { MigrationInterface, QueryRunner } from 'typeorm';

/** Coluna esperada pela entidade User; rotas já tinham migration de `accompanied`. */
export class AddAccompaniedToUsers1760700000000 implements MigrationInterface {
  name = 'AddAccompaniedToUsers1760700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "accompanied" character varying(32)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "accompanied"
    `);
  }
}
