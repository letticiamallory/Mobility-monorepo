import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Bancos que já tinham DEFAULT ou valores legados `both` passam a usar só `alone` | `companied`.
 */
export class SetAccompaniedDefaultToCompanied1750000000001 implements MigrationInterface {
  name = 'SetAccompaniedDefaultToCompanied1750000000001';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "routes"
      ALTER COLUMN "accompanied" SET DEFAULT 'companied'
    `);
    await queryRunner.query(`
      UPDATE "routes" SET "accompanied" = 'companied' WHERE "accompanied" = 'both'
    `);

    const usersCols = (await queryRunner.query(`
      SELECT 1 AS ok
      FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'users'
        AND column_name = 'accompanied'
      LIMIT 1
    `)) as Array<{ ok: number }>;

    if (usersCols.length > 0) {
      await queryRunner.query(`
        ALTER TABLE "users"
        ALTER COLUMN "accompanied" SET DEFAULT 'companied'
      `);
      await queryRunner.query(`
        UPDATE "users" SET "accompanied" = 'companied' WHERE "accompanied" = 'both'
      `);
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "routes"
      ALTER COLUMN "accompanied" SET DEFAULT 'both'
    `);
  }
}
