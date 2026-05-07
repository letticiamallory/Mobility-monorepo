/**
 * Regiões com dados de transporte no app (alinhado ao `otp-region.util.ts` da API).
 * Fora dessas caixas → tela “fora do alcance”.
 */

type BBox = { minLat: number; maxLat: number; minLng: number; maxLng: number };

export const MONTES_CLAROS_BBOX: BBox = {
  minLat: -16.95,
  maxLat: -16.52,
  minLng: -44.2,
  maxLng: -43.7,
};

export const BRASILIA_DF_BBOX: BBox = {
  minLat: -16.1,
  maxLat: -15.45,
  minLng: -48.35,
  maxLng: -47.25,
};

export const SAO_PAULO_SP_BBOX: BBox = {
  minLat: -24.2,
  maxLat: -23.0,
  minLng: -47.3,
  maxLng: -46.1,
};

function pointInBbox(lat: number, lng: number, b: BBox): boolean {
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

export function isPointInMobilityCoverage(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return (
    pointInBbox(lat, lng, MONTES_CLAROS_BBOX) ||
    pointInBbox(lat, lng, BRASILIA_DF_BBOX) ||
    pointInBbox(lat, lng, SAO_PAULO_SP_BBOX)
  );
}

/** Só Montes Claros — usado p.ex. para fallback de estações mock (dados em MC). */
export function isInMontesClarosArea(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  return pointInBbox(lat, lng, MONTES_CLAROS_BBOX);
}

export type CoverageCoord =
  | { latitude: number; longitude: number }
  | { lat: number; lng: number }
  | null
  | undefined;

function toLatLng(c: CoverageCoord): { lat: number; lng: number } | null {
  if (c == null) return null;
  if ('latitude' in c && 'longitude' in c) {
    const { latitude, longitude } = c;
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return null;
    return { lat: latitude, lng: longitude };
  }
  if ('lat' in c && 'lng' in c) {
    const { lat, lng } = c;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng };
  }
  return null;
}

/**
 * `true` = rota pode ser buscada (origem e destino dentro de pelo menos uma das três regiões).
 * Sem coordenadas válidas → `true` (deixa a API decidir).
 */
export function isRouteWithinMobilityCoverage(
  origin: CoverageCoord,
  destination: CoverageCoord,
): boolean {
  const o = toLatLng(origin);
  const d = toLatLng(destination);
  if (!o || !d) return true;
  return isPointInMobilityCoverage(o.lat, o.lng) && isPointInMobilityCoverage(d.lat, d.lng);
}
