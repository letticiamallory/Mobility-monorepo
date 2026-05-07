import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Remove valores lixo em `lines.schedules` (coluna text do simple-array),
 * ex.: `{}` ou texto sem nenhum HH:MM — isso virava `["{}"]` na API e o app mostrava "sem horários".
 */
export class ClearInvalidLinesSchedules1760100000000 implements MigrationInterface {
  name = 'ClearInvalidLinesSchedules1760100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "lines"
      SET "schedules" = NULL
      WHERE TRIM(COALESCE("schedules", '')) IN ('{}', '[]', '')
         OR (
           "schedules" IS NOT NULL
           AND TRIM("schedules") NOT LIKE '%:%'
         )
    `);
  }

  public async down(): Promise<void> {
    /* irreversível — dados inválidos não devem ser restaurados */
  }
}
