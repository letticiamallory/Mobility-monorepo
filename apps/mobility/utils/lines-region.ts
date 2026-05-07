/**
 * Região de linhas no app — mesmas caixas aproximadas do OTP no mobility-api.
 */
export type LinesRegionId = 'montes_claros' | 'brasilia' | 'sao_paulo';

type BBox = { minLat: number; maxLat: number; minLng: number; maxLng: number };

const MONTES_CLAROS: BBox = {
  minLat: -16.95,
  maxLat: -16.52,
  minLng: -44.2,
  maxLng: -43.7,
};

const BRASILIA: BBox = {
  minLat: -16.1,
  maxLat: -15.45,
  minLng: -48.35,
  maxLng: -47.25,
};

const SAO_PAULO: BBox = {
  minLat: -24.2,
  maxLat: -23.0,
  minLng: -47.3,
  maxLng: -46.1,
};

function inBox(lat: number, lng: number, b: BBox): boolean {
  return lat >= b.minLat && lat <= b.maxLat && lng >= b.minLng && lng <= b.maxLng;
}

/** Prioridade: SP → DF → Montes Claros (áreas não se sobrepõem na prática). */
export function detectLinesRegionFromCoords(
  lat: number,
  lng: number,
): LinesRegionId | null {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (inBox(lat, lng, SAO_PAULO)) return 'sao_paulo';
  if (inBox(lat, lng, BRASILIA)) return 'brasilia';
  if (inBox(lat, lng, MONTES_CLAROS)) return 'montes_claros';
  return null;
}

export function linesRegionLabel(id: LinesRegionId): string {
  switch (id) {
    case 'brasilia':
      return 'Brasília (DF)';
    case 'sao_paulo':
      return 'São Paulo (SP)';
    default:
      return 'Montes Claros (MG)';
  }
}
