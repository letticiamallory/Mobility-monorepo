import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddOriginDestinationTitlesToRoutes1752000000000 implements MigrationInterface {
  name = 'AddOriginDestinationTitlesToRoutes1752000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "routes" ADD COLUMN IF NOT EXISTS "origin_title" character varying(500)`,
    );
    await queryRunner.query(
      `ALTER TABLE "routes" ADD COLUMN IF NOT EXISTS "destination_title" character varying(500)`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "routes" DROP COLUMN IF EXISTS "destination_title"`);
    await queryRunner.query(`ALTER TABLE "routes" DROP COLUMN IF EXISTS "origin_title"`);
  }
}
