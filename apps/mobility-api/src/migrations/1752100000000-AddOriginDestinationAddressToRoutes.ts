import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOriginDestinationAddressToRoutes1752100000000 implements MigrationInterface {
  name = 'AddOriginDestinationAddressToRoutes1752100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "routes" ADD COLUMN IF NOT EXISTS "origin_address" character varying(1000)`,
    );
    await queryRunner.query(
      `ALTER TABLE "routes" ADD COLUMN IF NOT EXISTS "destination_address" character varying(1000)`,
    );
    await queryRunner.query(`
      UPDATE "routes"
      SET "origin_address" = "origin"
      WHERE "origin_address" IS NULL AND "origin" IS NOT NULL AND length(trim("origin")) > 0
    `);
    await queryRunner.query(`
      UPDATE "routes"
      SET "destination_address" = "destination"
      WHERE "destination_address" IS NULL AND "destination" IS NOT NULL AND length(trim("destination")) > 0
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "routes" DROP COLUMN IF EXISTS "destination_address"`);
    await queryRunner.query(`ALTER TABLE "routes" DROP COLUMN IF EXISTS "origin_address"`);
  }
}
