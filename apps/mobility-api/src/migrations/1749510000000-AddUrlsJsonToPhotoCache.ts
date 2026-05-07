import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUrlsJsonToPhotoCache1749510000000 implements MigrationInterface {
  name = 'AddUrlsJsonToPhotoCache1749510000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "photo_cache" ADD COLUMN IF NOT EXISTS "urls_json" text`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "photo_cache" DROP COLUMN IF EXISTS "urls_json"`,
    );
  }
}
