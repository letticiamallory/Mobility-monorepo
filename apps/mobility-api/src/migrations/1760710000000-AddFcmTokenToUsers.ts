import { MigrationInterface, QueryRunner } from 'typeorm';

/** Push notifications — antes só havia script SQL manual em migrations/add-users-fcm-token.sql. */
export class AddFcmTokenToUsers1760710000000 implements MigrationInterface {
  name = 'AddFcmTokenToUsers1760710000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      ADD COLUMN IF NOT EXISTS "fcm_token" character varying(255)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "users"
      DROP COLUMN IF EXISTS "fcm_token"
    `);
  }
}
