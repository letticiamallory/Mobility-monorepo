/**
 * One-shot job para docker-compose: espera a API, só chama POST /lines/seed se
 * o banco estiver sem linhas (volume novo) ou FORCE_LINES_SEED=1.
 * (Heurística por horários falha com linhas SP só via Olho Vivo, sem grade estática.)
 *
 * Env:
 * - API_URL (default http://api:3000)
 * - API_NODE_ENV / NODE_ENV — em production exige LINES_SEED_SECRET
 * - LINES_SEED_SECRET — header x-lines-seed-secret se definido
 * - FORCE_LINES_SEED=1 — ignora heurística e sempre faz POST
 */

const API_URL = (process.env.API_URL ?? 'http://api:3000').replace(/\/$/, '');
const LINES_SEED_SECRET = process.env.LINES_SEED_SECRET?.trim() ?? '';
const NODE_ENV = process.env.API_NODE_ENV ?? process.env.NODE_ENV ?? 'development';
const FORCE = ['1', 'true', 'yes', 'on'].includes(
  String(process.env.FORCE_LINES_SEED ?? '').trim().toLowerCase(),
);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitForApi(maxAttempts = 90) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const r = await fetch(`${API_URL}/`);
      if (r.ok) {
        console.log('[lines-seed] API respondeu em /');
        return;
      }
    } catch {
      /* ainda não sobeu */
    }
    await sleep(2000);
  }
  throw new Error('[lines-seed] timeout esperando a API');
}

async function main() {
  await waitForApi();

  const linesRes = await fetch(`${API_URL}/lines`);
  if (!linesRes.ok) {
    console.error('[lines-seed] GET /lines falhou:', linesRes.status);
    process.exit(1);
  }
  const lines = await linesRes.json();
  if (!Array.isArray(lines)) {
    console.error('[lines-seed] resposta /lines inesperada');
    process.exit(1);
  }

  const needSeed = FORCE || lines.length === 0;

  if (!needSeed) {
    console.log(
      '[lines-seed] Banco já tem linhas; pulando POST /lines/seed (use FORCE_LINES_SEED=1 para forçar).',
    );
    process.exit(0);
  }

  if (NODE_ENV === 'production' && !LINES_SEED_SECRET) {
    console.error(
      '[lines-seed] Com NODE_ENV=production defina LINES_SEED_SECRET (e o mesmo valor no serviço api).',
    );
    process.exit(1);
  }

  console.log('[lines-seed] Executando POST /lines/seed (pode levar vários minutos)...');
  /** @type {Record<string, string>} */
  const headers = {};
  if (LINES_SEED_SECRET) headers['x-lines-seed-secret'] = LINES_SEED_SECRET;

  const seedRes = await fetch(`${API_URL}/lines/seed`, { method: 'POST', headers });
  const body = await seedRes.text();
  if (!seedRes.ok) {
    console.error('[lines-seed] falhou:', seedRes.status, body);
    process.exit(1);
  }
  console.log('[lines-seed] concluído:', body);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
