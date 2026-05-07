import axios from 'axios';
import { unzipSync } from 'fflate';
import type { Line } from './line.entity';

/** GTFS público SPTrans (sem token). Sobrescreva com `SPTRANS_GTFS_URL` se necessário. */
export const SPTRANS_DEFAULT_GTFS_URL =
  'https://www.sptrans.com.br/umbraco/Surface/PerfilDesenvolvedor/BaixarGTFS';

/** Parser CSV mínimo (campos entre aspas, como no routes.txt da SPTrans). */
function parseGtfsCsvRows(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;

  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    if (row.some((c) => c.length > 0)) rows.push(row);
    row = [];
  };

  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      pushField();
    } else if (c === '\n') {
      pushField();
      pushRow();
    } else if (c === '\r') {
      // \r\n
    } else {
      field += c;
    }
  }
  pushField();
  if (row.length) pushRow();
  return rows;
}

function headerIndex(header: string[], name: string): number {
  const i = header.indexOf(name);
  if (i < 0) {
    throw new Error(`GTFS routes.txt: coluna ausente "${name}"`);
  }
  return i;
}

function splitOriginDestination(longName: string): {
  origin: string;
  destination: string;
} {
  const t = longName.trim();
  const sep = ' - ';
  const j = t.indexOf(sep);
  if (j <= 0) {
    return { origin: '—', destination: '—' };
  }
  return {
    origin: t.slice(0, j).trim() || '—',
    destination: t.slice(j + sep.length).trim() || '—',
  };
}

/**
 * Catálogo de linhas de ônibus SP a partir do GTFS oficial (route_type 3).
 * Não inclui horários estáticos no campo `schedules` (usar outras fontes se precisar).
 */
export async function fetchSaoPauloLinesFromGtfs(
  gtfsUrl?: string,
): Promise<Array<Omit<Line, 'id' | 'created_at'>>> {
  const url = (gtfsUrl?.trim() || SPTRANS_DEFAULT_GTFS_URL).trim();
  const res = await axios.get<ArrayBuffer>(url, {
    responseType: 'arraybuffer',
    timeout: 180_000,
    maxContentLength: 80 * 1024 * 1024,
    maxBodyLength: 80 * 1024 * 1024,
    validateStatus: (s) => s === 200,
    headers: {
      'User-Agent': 'MobilityAPI/1.0 (lines gtfs; +https://github.com/)',
    },
  });

  const extracted = unzipSync(new Uint8Array(res.data), { filter: (f) => f.name === 'routes.txt' });
  const routesEntry = extracted['routes.txt'];
  if (!routesEntry?.length) {
    throw new Error('GTFS: routes.txt não encontrado no zip');
  }

  const text = new TextDecoder('utf-8').decode(routesEntry);
  const table = parseGtfsCsvRows(text);
  if (table.length < 2) {
    throw new Error('GTFS: routes.txt vazio');
  }

  const h = table[0];
  const iShort = headerIndex(h, 'route_short_name');
  const iLong = headerIndex(h, 'route_long_name');
  const iType = headerIndex(h, 'route_type');
  const iId = h.includes('route_id') ? h.indexOf('route_id') : -1;

  const byCode = new Map<string, Omit<Line, 'id' | 'created_at'>>();
  for (let r = 1; r < table.length; r++) {
    const row = table[r];
    if (row.length < h.length) continue;
    const routeType = String(row[iType] ?? '').trim();
    if (routeType !== '3') continue;

    const shortName = String(row[iShort] ?? '').trim();
    const longName = String(row[iLong] ?? '').trim();
    const routeId = iId >= 0 ? String(row[iId] ?? '').trim() : '';
    const code = shortName || routeId;
    if (!code) continue;

    const { origin, destination } = splitOriginDestination(longName);
    const name = longName || code;

    if (!byCode.has(code)) {
      byCode.set(code, {
        region: 'sao_paulo',
        code,
        name,
        origin,
        destination,
        via: null,
        accessible: true,
        schedules: null,
      });
    }
  }

  return [...byCode.values()];
}
