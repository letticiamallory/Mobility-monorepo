import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddGoogleIdToUsers1746111600000 implements MigrationInterface {
  name = 'AddGoogleIdToUsers1746111600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "google_id" character varying
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "google_id"
    `);
  }
}
