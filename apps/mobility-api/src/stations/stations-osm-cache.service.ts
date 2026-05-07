import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { mkdir, readFile, writeFile } from 'fs/promises';
import { dirname } from 'path';

export type OsmStationRow = {
  id: string;
  name: string;
  lat: number;
  lng: number;
  /** Por enquanto, só diferenciamos 'bus' vs 'subway'. Em Montes Claros, será quase sempre 'bus'. */
  type: 'bus' | 'subway';
  /** Linha(s) quando existirem em tags OSM (ex.: route_ref). */
  lines: string[];
  /** Endereço / referência legível (rua, bairro) para o subtítulo do card. */
  address: string;
  /** Derivado da tag wheelchair=yes|no quando presente. */
  accessible: boolean;
};

/** BBox aproximada de Montes Claros (suficiente para pré-carga de paradas). */
const MC_BBOX = {
  south: -16.86,
  west: -44.08,
  north: -16.60,
  east: -43.78,
};

function stationCachePath(): string {
  // Persistido “dentro do container” (FS do container). Em dev local, fica no repo.
  // v4: enriquecimento de endereço vazio via Nominatim (geocodificação reversa).
  return process.env.STATIONS_MC_CACHE_PATH?.trim() || 'otp/data/stations-montes-claros-v4.json';
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** PT-BR curto para o card, a partir do JSON do Nominatim. */
function formatNominatimAddress(data: {
  address?: Record<string, string>;
  display_name?: string;
}): string | null {
  const a = data?.address;
  if (!a) {
    const d = data?.display_name;
    if (typeof d === 'string' && d.trim()) {
      return d
        .split(',')
        .map((s) => s.trim())
        .slice(0, 4)
        .join(' · ');
    }
    return null;
  }
  const road =
    a.road || a.pedestrian || a.path || a.residential || a.footway || a.service;
  const suburb =
    a.suburb || a.neighbourhood || a.quarter || a.city_district || a.hamlet;
  const city = a.city || a.town || a.municipality || a.village;
  const parts: string[] = [];
  if (road) parts.push(String(road));
  if (suburb) parts.push(String(suburb));
  else if (city) parts.push(String(city));
  if (parts.length) return parts.join(' · ');
  const d = data.display_name;
  if (typeof d === 'string' && d.trim()) {
    return d
      .split(',')
      .map((s) => s.trim())
      .slice(0, 4)
      .join(' · ');
  }
  return null;
}

async function reverseGeocodeNominatim(
  lat: number,
  lng: number,
  contactEmail: string,
): Promise<string | null> {
  const base = process.env.NOMINATIM_URL?.trim() || 'https://nominatim.openstreetmap.org';
  const url = new URL(`${base.replace(/\/$/, '')}/reverse`);
  url.searchParams.set('lat', String(lat));
  url.searchParams.set('lon', String(lng));
  url.searchParams.set('format', 'json');
  url.searchParams.set('addressdetails', '1');
  url.searchParams.set('zoom', '18');

  try {
    const { data } = await axios.get(url.toString(), {
      headers: {
        Accept: 'application/json',
        'Accept-Language': 'pt-BR,pt;q=0.9',
        'User-Agent': `mobility-api/1.0 (stations; contact: ${contactEmail})`,
      },
      timeout: 20_000,
    });
    return formatNominatimAddress(data as { address?: Record<string, string>; display_name?: string });
  } catch {
    return null;
  }
}

function parseRouteRefs(tags: Record<string, string>): string[] {
  const keys = [
    'route_ref',
    'bus:routes',
    'lines',
    'gtfs:route_ref',
    'line',
    'bus:line',
    'public_transport:routes',
    /** Algumas regiões usam route como código único */
    'route',
  ] as const;
  const seen = new Set<string>();
  for (const k of keys) {
    const v = tags[k]?.trim();
    if (!v) continue;
    for (const part of v.split(/[;,|]/)) {
      const s = part.trim();
      if (s) seen.add(s);
    }
  }
  return [...seen].slice(0, 16);
}

function buildAddress(tags: Record<string, string>): string {
  const street = tags['addr:street']?.trim();
  const num = tags['addr:housenumber']?.trim();
  const suburb = tags['addr:suburb']?.trim() || tags['addr:district']?.trim();
  const city = tags['addr:city']?.trim();
  const line1 =
    street && num ? `${street}, ${num}` : street || '';
  const parts = [line1, suburb, city && !line1 ? city : ''].filter(Boolean);
  const joined = parts.join(' · ');
  if (joined) return joined;
  const operator = tags.operator?.trim();
  const network = tags.network?.trim();
  if (operator && network) return `${network} · ${operator}`;
  if (operator || network) return operator || network || '';

  const from = tags.from?.trim();
  const towards = tags.towards?.trim();
  const via = tags.via?.trim();
  const dir: string[] = [];
  if (from) dir.push(`Saindo de ${from}`);
  if (towards) dir.push(`direção ${towards}`);
  if (via) dir.push(`via ${via}`);
  if (dir.length) return dir.join(' · ');

  const loc = tags['is_in']?.trim() || tags['addr:place']?.trim();
  if (loc) return loc;

  const shelter = tags.shelter === 'yes';
  const bench = tags.bench === 'yes';
  const infra: string[] = [];
  if (shelter) infra.push('Abrigo');
  if (bench) infra.push('Banco');
  if (infra.length) return infra.join(' · ');

  return '';
}

function wheelchairAccessible(tags: Record<string, string>): boolean {
  const w = tags.wheelchair?.toLowerCase().trim();
  if (w === 'no' || w === 'false') return false;
  if (w === 'yes' || w === 'designated' || w === 'limited') return true;
  return true;
}

/** Nome legível para o card: evita dezenas de “Parada” idênticas. */
function buildDisplayName(
  tags: Record<string, string>,
  osmType: string,
  osmId: number,
): string {
  const direct =
    tags.name?.trim() ||
    tags['name:pt']?.trim() ||
    tags.official_name?.trim() ||
    tags['public_transport:name']?.trim();
  if (direct) return direct;

  const ref =
    tags.ref?.trim() ||
    tags.local_ref?.trim() ||
    tags['naptan:AtcoCode']?.trim() ||
    tags['ref:br']?.trim();
  if (ref) return `Parada ${ref}`;

  const street = tags['addr:street']?.trim();
  const suburb = tags['addr:suburb']?.trim() || tags['addr:district']?.trim();
  if (street && suburb) return `Parada — ${street} (${suburb})`;
  if (street) return `Parada — ${street}`;
  if (suburb) return `Parada — ${suburb}`;

  const dest = tags.destination?.trim();
  if (dest) return `Parada — ${dest}`;

  // Último recurso: único por OSM (melhor que repetir só “Parada”).
  return `Parada ${osmType[0]}/${osmId}`;
}

@Injectable()
export class StationsOsmCacheService {
  private readonly logger = new Logger(StationsOsmCacheService.name);
  private memo: OsmStationRow[] | null = null;
  private inflight: Promise<OsmStationRow[]> | null = null;

  /** Estações/paradas de Montes Claros pré-carregadas (arquivo) ou coletadas via Overpass. */
  async getMontesClarosStations(): Promise<OsmStationRow[]> {
    if (this.memo) return this.memo;
    if (this.inflight) return this.inflight;
    this.inflight = this.loadOrFetch().finally(() => {
      this.inflight = null;
    });
    this.memo = await this.inflight;
    return this.memo;
  }

  private async loadOrFetch(): Promise<OsmStationRow[]> {
    const path = stationCachePath();
    let rows = (await this.tryReadJson(path)) ?? [];
    let needSave = false;
    if (!rows.length) {
      rows = await this.fetchFromOverpass();
      needSave = rows.length > 0;
    }

    const { rows: enriched, dirty } = await this.enrichMissingAddresses(rows);
    if (needSave || dirty) {
      await this.safeWriteJson(path, enriched);
    }
    return enriched;
  }

  /**
   * Preenche `address` com geocodificação reversa (Nominatim), respeitando a política de uso
   * (~1 req/s). Não é “scraping” de sites aleatórios; é a API oficial ligada ao OSM.
   * Defina NOMINATIM_CONTACT_EMAIL (e-mail válido) para ativar. STATIONS_SKIP_NOMINATIM=1 desliga.
   */
  private async enrichMissingAddresses(
    rows: OsmStationRow[],
  ): Promise<{ rows: OsmStationRow[]; dirty: boolean }> {
    if (process.env.STATIONS_SKIP_NOMINATIM?.trim() === '1') {
      return { rows, dirty: false };
    }
    const email = process.env.NOMINATIM_CONTACT_EMAIL?.trim();
    if (!email) {
      this.logger.warn(
        'NOMINATIM_CONTACT_EMAIL não definido; endereços só vêm das tags OSM. ' +
          'Configure um e-mail de contato para ativar o enriquecimento via Nominatim.',
      );
      return { rows, dirty: false };
    }

    const maxRaw = process.env.STATIONS_NOMINATIM_MAX?.trim();
    const max = maxRaw ? Math.max(0, parseInt(maxRaw, 10) || 0) : 500;
    const out = rows.map((r) => ({ ...r }));
    let dirty = false;
    let done = 0;

    for (let i = 0; i < out.length; i++) {
      if (out[i].address?.trim()) continue;
      if (done >= max) break;

      const addr = await reverseGeocodeNominatim(out[i].lat, out[i].lng, email);
      done += 1;
      if (addr?.trim()) {
        out[i] = { ...out[i], address: addr.trim() };
        dirty = true;
      }
      await sleep(1100);
    }

    if (done > 0) {
      this.logger.log(`stations MC Nominatim: ${done} consulta(s), cache ${dirty ? 'atualizado' : 'sem novos endereços'}`);
    }
    return { rows: out, dirty };
  }

  private async tryReadJson(path: string): Promise<OsmStationRow[] | null> {
    try {
      const raw = await readFile(path, 'utf8');
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return null;
      const ok = parsed
        .filter((row: any) => {
          return (
            row &&
            typeof row.id === 'string' &&
            typeof row.name === 'string' &&
            typeof row.lat === 'number' &&
            typeof row.lng === 'number' &&
            (row.type === 'bus' || row.type === 'subway')
          );
        })
        .map((row: any) => ({
          ...row,
          lines: Array.isArray(row.lines) ? row.lines.map((x: unknown) => String(x)) : [],
          address: typeof row.address === 'string' ? row.address : '',
          accessible: row.accessible === false ? false : true,
        })) as OsmStationRow[];
      if (ok.length) this.logger.log(`stations MC cache HIT: ${path} (${ok.length})`);
      return ok.length ? ok : null;
    } catch {
      return null;
    }
  }

  private async safeWriteJson(path: string, rows: OsmStationRow[]) {
    try {
      await mkdir(dirname(path), { recursive: true });
      await writeFile(path, JSON.stringify(rows), 'utf8');
      this.logger.log(`stations MC cache SET: ${path} (${rows.length})`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`stations MC cache write failed: ${msg}`);
    }
  }

  private async fetchFromOverpass(): Promise<OsmStationRow[]> {
    const { south, west, north, east } = MC_BBOX;
    const query = `
      [out:json][timeout:90];
      (
        node["highway"="bus_stop"](${south},${west},${north},${east});
        node["public_transport"="platform"](${south},${west},${north},${east});
        node["public_transport"="stop_position"](${south},${west},${north},${east});
        node["amenity"="bus_station"](${south},${west},${north},${east});
        node["railway"="station"](${south},${west},${north},${east});
        way["highway"="bus_stop"](${south},${west},${north},${east});
        way["amenity"="bus_station"](${south},${west},${north},${east});
        way["public_transport"="platform"](${south},${west},${north},${east});
      );
      out center tags;
    `;

    const base =
      process.env.OVERPASS_URL?.trim() || 'https://overpass-api.de/api/interpreter';
    const url = `${base}?data=${encodeURIComponent(query)}`;

    try {
      const { data } = await axios.get(url, {
        headers: { Accept: 'application/json', 'User-Agent': 'mobility-api/1.0 (stations preload)' },
        timeout: 95_000,
      });
      const elements: any[] = Array.isArray(data?.elements) ? data.elements : [];
      const out: OsmStationRow[] = [];
      const seen = new Set<string>();

      for (const el of elements) {
        const osmType = typeof el?.type === 'string' ? el.type : 'node';
        const osmId = typeof el?.id === 'number' ? el.id : NaN;
        if (!Number.isFinite(osmId)) continue;

        let lat: number | null = null;
        let lng: number | null = null;
        if (typeof el?.lat === 'number' && typeof el?.lon === 'number') {
          lat = el.lat;
          lng = el.lon;
        } else if (
          el?.center &&
          typeof el.center.lat === 'number' &&
          typeof el.center.lon === 'number'
        ) {
          lat = el.center.lat;
          lng = el.center.lon;
        }
        if (lat == null || lng == null) continue;

        const id = `${osmType}/${osmId}`;
        if (seen.has(id)) continue;
        seen.add(id);

        const tags: Record<string, string> = {};
        const rawTags = el?.tags;
        if (rawTags && typeof rawTags === 'object') {
          for (const [k, v] of Object.entries(rawTags)) {
            if (typeof v === 'string') tags[k] = v;
          }
        }

        const name = buildDisplayName(tags, osmType, osmId);
        const address = buildAddress(tags);
        const lines = parseRouteRefs(tags);
        const accessible = wheelchairAccessible(tags);

        const type: 'bus' | 'subway' =
          tags.railway === 'station' ? 'subway' : 'bus';

        out.push({ id, name, lat, lng, type, lines, address, accessible });
      }

      this.logger.log(`stations MC overpass fetched: ${out.length}`);
      return out;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      this.logger.warn(`stations MC overpass failed: ${msg}`);
      return [];
    }
  }
}

