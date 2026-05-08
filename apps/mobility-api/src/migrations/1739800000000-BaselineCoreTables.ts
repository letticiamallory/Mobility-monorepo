import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Banco novo: as migrations antigas começavam com ALTER em `users`/`routes` sem CREATE inicial.
 * Esta baseline roda antes de CreatePhotoCache (1739923200000).
 */
export class BaselineCoreTables1739800000000 implements MigrationInterface {
  name = 'BaselineCoreTables1739800000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DO $$ BEGIN
        CREATE TYPE "users_disability_type_enum" AS ENUM ('visual', 'wheelchair', 'reduced_mobility');
      EXCEPTION
        WHEN duplicate_object THEN NULL;
      END $$;
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "users" (
        "id" SERIAL NOT NULL,
        "name" character varying NOT NULL,
        "email" character varying NOT NULL,
        "password" character varying NOT NULL,
        "disability_type" "users_disability_type_enum" NOT NULL,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_users_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "routes" (
        "id" SERIAL NOT NULL,
        "user_id" integer NOT NULL,
        "origin" character varying NOT NULL,
        "destination" character varying NOT NULL,
        "transport_type" character varying NOT NULL,
        "accessible" boolean NOT NULL DEFAULT true,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_routes_id" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "places" (
        "id" SERIAL NOT NULL,
        "name" character varying NOT NULL,
        "type" character varying NOT NULL,
        "city" character varying NOT NULL,
        "address" character varying NOT NULL,
        "accessible" boolean NOT NULL,
        "disability_type" character varying NOT NULL,
        "observation" character varying,
        "created_at" TIMESTAMP NOT NULL DEFAULT now(),
        CONSTRAINT "PK_places_id" PRIMARY KEY ("id")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "places"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "routes"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "users"`);
    await queryRunner.query(`DROP TYPE IF EXISTS "users_disability_type_enum"`);
  }
}
