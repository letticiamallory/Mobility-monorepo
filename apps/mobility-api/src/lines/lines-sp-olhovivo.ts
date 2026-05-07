import axios, { type AxiosInstance } from 'axios';
import type { Line } from './line.entity';

type OlhovivoLinhaRow = {
  cl: number;
  lc: boolean;
  lt: string;
  sl: number;
  tl: number;
  tp: string;
  ts: string;
};

const BASE = 'https://api.olhovivo.sptrans.com.br/v2.1';

function buildSearchTerms(): string[] {
  const terms = new Set<string>();
  for (let i = 0; i <= 9; i++) terms.add(String(i));
  for (let i = 10; i <= 90; i += 10) terms.add(String(i));
  for (let i = 100; i <= 900; i += 100) terms.add(String(i));
  for (const w of [
    'lapa',
    'penha',
    'santana',
    'tatuape',
    'pinheiros',
    'butanta',
    'itaquera',
    'sao mateus',
    'jabaquara',
    'term',
    'metro',
    'corre',
  ]) {
    terms.add(w);
  }
  return [...terms];
}

function cookieFromSetCookie(raw: string[] | undefined): string {
  if (!raw?.length) return '';
  return raw.map((c) => c.split(';')[0]).join('; ');
}

/**
 * Catálogo de linhas SP via API Olho Vivo (SPTrans).
 * O seed em `LinesService` usa GTFS público (`lines-sp-gtfs.ts`); este módulo permanece
 * útil para integrações em tempo real (posição, previsão) com token de desenvolvedor.
 */
export async function fetchSaoPauloLinesViaOlhoVivo(
  apiToken: string | undefined,
): Promise<Array<Omit<Line, 'id' | 'created_at'>>> {
  const token = apiToken?.trim();
  if (!token) return [];

  const client: AxiosInstance = axios.create({
    timeout: 25_000,
    validateStatus: () => true,
    headers: {
      'User-Agent': 'MobilityAPI/1.0 (lines; +https://github.com/)',
    },
  });

  const auth = await client.post(`${BASE}/Login/Autenticar`, undefined, {
    params: { token },
  });
  const ok =
    auth.status === 200 && (auth.data === true || auth.data === 'true');
  if (!ok) {
    return [];
  }

  const cookie = cookieFromSetCookie(auth.headers['set-cookie']);
  if (!cookie) return [];

  const byCl = new Map<number, OlhovivoLinhaRow>();
  const terms = buildSearchTerms();

  for (const termosBusca of terms) {
    const r = await client.get<OlhovivoLinhaRow[]>(`${BASE}/Linha/Buscar`, {
      params: { termosBusca },
      headers: { Cookie: cookie },
    });
    if (r.status !== 200 || !Array.isArray(r.data)) continue;
    for (const row of r.data) {
      if (row && typeof row.cl === 'number' && !byCl.has(row.cl)) {
        byCl.set(row.cl, row);
      }
    }
    await new Promise((res) => setTimeout(res, 120));
  }

  const out: Array<Omit<Line, 'id' | 'created_at'>> = [];
  for (const row of byCl.values()) {
    const code = String(row.cl);
    const name = `${row.lt}-${row.tl} ${row.tp} / ${row.ts}`.replace(/\s+/g, ' ').trim();
    out.push({
      region: 'sao_paulo',
      code,
      name,
      origin: row.tp?.trim() || '—',
      destination: row.ts?.trim() || '—',
      via: null,
      accessible: true,
      schedules: null,
    });
  }
  return out;
}
