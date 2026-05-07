import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateLinesTable1760000000000 implements MigrationInterface {
  name = 'CreateLinesTable1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "lines" (
        "id" SERIAL NOT NULL,
        "code" character varying NOT NULL,
        "name" character varying NOT NULL,
        "origin" character varying NOT NULL,
        "destination" character varying NOT NULL,
        "via" character varying,
        "accessible" boolean NOT NULL DEFAULT true,
        "schedules" text,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_lines_code" UNIQUE ("code"),
        CONSTRAINT "PK_lines_id" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "lines"`);
  }
}
