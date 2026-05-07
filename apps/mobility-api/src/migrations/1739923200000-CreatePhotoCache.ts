import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePhotoCache1739923200000 implements MigrationInterface {
  name = 'CreatePhotoCache1739923200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "photo_cache" (
        "id" SERIAL NOT NULL,
        "cache_key" character varying NOT NULL,
        "photo_url" text NOT NULL,
        "source" character varying,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        "expires_at" TIMESTAMP,
        CONSTRAINT "UQ_photo_cache_cache_key" UNIQUE ("cache_key"),
        CONSTRAINT "PK_photo_cache_id" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "photo_cache"`);
  }
}
