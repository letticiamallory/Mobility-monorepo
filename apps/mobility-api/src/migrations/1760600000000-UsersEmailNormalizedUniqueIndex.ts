import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Login e cadastro usam LOWER(TRIM(email)). Sem índice alinhado, o Postgres faz seq scan
 * em cada autenticação — degrada com muitos usuários. O índice único também evita
 * corrida entre duas requisições simultâneas criando o mesmo e-mail.
 */
export class UsersEmailNormalizedUniqueIndex1760600000000
  implements MigrationInterface
{
  name = 'UsersEmailNormalizedUniqueIndex1760600000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    /**
     * Duplicatas por e-mail (mesmo LOWER(TRIM)) impedem índice único.
     * Mantém o menor `id` por e-mail; histórico de rotas segue o usuário mantido.
     */
    await queryRunner.query(`
      UPDATE "routes" r
      SET "user_id" = k."keep_id"
      FROM "users" u
      INNER JOIN (
        SELECT MIN(id) AS "keep_id", LOWER(TRIM("email")) AS "norm_email"
        FROM "users"
        GROUP BY LOWER(TRIM("email"))
      ) k ON LOWER(TRIM(u.email)) = k."norm_email"
      WHERE r."user_id" = u.id AND u.id != k."keep_id"
    `);
    await queryRunner.query(`
      DELETE FROM "users" u
      USING (
        SELECT MIN(id) AS "keep_id", LOWER(TRIM("email")) AS "norm_email"
        FROM "users"
        GROUP BY LOWER(TRIM("email"))
      ) k
      WHERE LOWER(TRIM(u.email)) = k."norm_email" AND u.id != k."keep_id"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "IDX_users_email_normalized"
      ON "users" (LOWER(TRIM("email")))
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_users_email_normalized"
    `);
  }
}
