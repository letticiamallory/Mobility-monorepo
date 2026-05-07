/**
 * Regiões atendidas por instâncias OTP distintas (Montes Claros × Brasília/DF).
 * Caixas são retângulos aproximados em WGS84 — suficientes para escolher qual servidor chamar.
 */

export type OtpRegionId = 'montes_claros' | 'brasilia' | 'sao_paulo' | 'unknown';

type BBox = { minLat: number; maxLat: number; minLng: number; maxLng: number };

/** Montes Claros (MG) — área urbana aproximada. */
export const MONTES_CLAROS_BBOX: BBox = {
  minLat: -16.95,
  maxLat: -16.52,
  minLng: -44.2,
  maxLng: -43.7,
};

/**
 * Brasília e entorno imediato do DF (inclui satélites próximos).
 * O PBF recomendado no README é o extrato Geofabrik **Centro-Oeste** (~165 MB), maior que só o DF.
 */
export const BRASILIA_DF_BBOX: BBox = {
  minLat: -16.1,
  maxLat: -15.45,
  minLng: -48.35,
  maxLng: -47.25,
};

/**
 * São Paulo (SP) — bbox metropolitana (aproximada).
 * Observação: o grafo OSM usado hoje (Geofabrik Sudeste) é maior que só SP.
 */
export const SAO_PAULO_SP_BBOX: BBox = {
  minLat: -24.2,
  maxLat: -23.0,
  minLng: -47.3,
  maxLng: -46.1,
};

export function pointInBbox(lat: number, lng: number, b: BBox): boolean {
  return (
    lat >= b.minLat &&
    lat <= b.maxLat &&
    lng >= b.minLng &&
    lng <= b.maxLng
  );
}

/**
 * Decide qual região usar para uma consulta origem→destino.
 * Se origem e destino caem na mesma região conhecida, devolve essa região.
 * Se só um dos pontos está em uma região, usa essa região (ex.: rota saindo da cidade).
 * Se ambos estão em regiões diferentes ou fora, devolve `unknown` (caller usa OTP_URL padrão).
 */
export function detectOtpRegionForRoute(
  originLat: number,
  originLng: number,
  destLat: number,
  destLng: number,
): OtpRegionId {
  const oMc = pointInBbox(originLat, originLng, MONTES_CLAROS_BBOX);
  const dMc = pointInBbox(destLat, destLng, MONTES_CLAROS_BBOX);
  const oBs = pointInBbox(originLat, originLng, BRASILIA_DF_BBOX);
  const dBs = pointInBbox(destLat, destLng, BRASILIA_DF_BBOX);
  const oSp = pointInBbox(originLat, originLng, SAO_PAULO_SP_BBOX);
  const dSp = pointInBbox(destLat, destLng, SAO_PAULO_SP_BBOX);

  if (oMc && dMc) return 'montes_claros';
  if (oBs && dBs) return 'brasilia';
  if (oSp && dSp) return 'sao_paulo';

  if (oMc && !dMc && !oBs && !dBs) return 'montes_claros';
  if (dMc && !oMc && !oBs && !dBs) return 'montes_claros';
  if (oBs && !dBs && !oMc && !dMc) return 'brasilia';
  if (dBs && !oBs && !oMc && !dMc) return 'brasilia';
  if (oSp && !dSp && !oMc && !dMc && !oBs && !dBs) return 'sao_paulo';
  if (dSp && !oSp && !oMc && !dMc && !oBs && !dBs) return 'sao_paulo';

  if (oMc && dBs) return 'unknown';
  if (oBs && dMc) return 'unknown';
  if (oSp && (dMc || dBs)) return 'unknown';
  if (dSp && (oMc || oBs)) return 'unknown';

  if (oMc || dMc) return 'montes_claros';
  if (oBs || dBs) return 'brasilia';
  if (oSp || dSp) return 'sao_paulo';

  return 'unknown';
}
