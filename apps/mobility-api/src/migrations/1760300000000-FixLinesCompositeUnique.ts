import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Removes legacy unique-on-code-only constraints (e.g. from sync or older PG names
 * like lines_code_key) so the same line code can exist in different regions.
 */
export class FixLinesCompositeUnique1760300000000 implements MigrationInterface {
  name = 'FixLinesCompositeUnique1760300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "lines" DROP CONSTRAINT IF EXISTS "lines_code_key"
    `);
    await queryRunner.query(`
      ALTER TABLE "lines" DROP CONSTRAINT IF EXISTS "UQ_lines_code"
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint WHERE conname = 'UQ_lines_region_code'
        ) THEN
          ALTER TABLE "lines"
            ADD CONSTRAINT "UQ_lines_region_code" UNIQUE ("region", "code");
        END IF;
      END $$;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "lines" DROP CONSTRAINT IF EXISTS "UQ_lines_region_code"
    `);
    await queryRunner.query(`
      ALTER TABLE "lines" ADD CONSTRAINT "UQ_lines_code" UNIQUE ("code")
    `);
  }
}
