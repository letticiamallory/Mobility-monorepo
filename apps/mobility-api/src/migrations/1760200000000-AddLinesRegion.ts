import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLinesRegion1760200000000 implements MigrationInterface {
  name = 'AddLinesRegion1760200000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "lines" ADD COLUMN IF NOT EXISTS "region" character varying NOT NULL DEFAULT 'montes_claros'
    `);
    await queryRunner.query(`
      UPDATE "lines" SET "region" = 'montes_claros' WHERE "region" IS NULL OR TRIM("region") = ''
    `);
    await queryRunner.query(`
      ALTER TABLE "lines" DROP CONSTRAINT IF EXISTS "UQ_lines_code"
    `);
    await queryRunner.query(`
      ALTER TABLE "lines" ADD CONSTRAINT "UQ_lines_region_code" UNIQUE ("region", "code")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "lines" DROP CONSTRAINT IF EXISTS "UQ_lines_region_code"
    `);
    await queryRunner.query(`
      ALTER TABLE "lines" ADD CONSTRAINT "UQ_lines_code" UNIQUE ("code")
    `);
    await queryRunner.query(`
      ALTER TABLE "lines" DROP COLUMN IF EXISTS "region"
    `);
  }
}
