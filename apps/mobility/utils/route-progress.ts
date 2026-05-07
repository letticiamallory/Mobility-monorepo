export type LatLng = { latitude: number; longitude: number };

type RouteStageLike = {
  mode: string;
  instruction: string;
};

type SerializedRouteLike = {
  stages: { points?: LatLng[] }[];
};

/** Distância em metros (fórmula de Haversine). */
export function haversineMeters(a: LatLng, b: LatLng): number {
  const R = 6371000;
  const φ1 = (a.latitude * Math.PI) / 180;
  const φ2 = (b.latitude * Math.PI) / 180;
  const Δφ = ((b.latitude - a.latitude) * Math.PI) / 180;
  const Δλ = ((b.longitude - a.longitude) * Math.PI) / 180;
  const s =
    Math.sin(Δφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(Δλ / 2) ** 2;
  return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

/** Índice do vértice da polyline mais próximo do ponto (força bruta; N típico < 500). */
export function closestPolylineVertexIndex(user: LatLng, polyline: LatLng[]): number {
  if (polyline.length === 0) return 0;
  let best = 0;
  let bestD = Infinity;
  for (let i = 0; i < polyline.length; i++) {
    const d = haversineMeters(user, polyline[i]);
    if (d < bestD) {
      bestD = d;
      best = i;
    }
  }
  return best;
}

/**
 * Para cada etapa, índice do primeiro ponto dessa etapa na polyline completa
 * (mesma ordem que `buildPolylineCoords`: origem, pontos por etapa, destino).
 */
export function stageFirstPolylineIndices(route: SerializedRouteLike): number[] {
  const indices: number[] = [];
  let idx = 1;
  for (let i = 0; i < route.stages.length; i++) {
    indices.push(idx);
    const pts = route.stages[i].points;
    idx += Array.isArray(pts) ? pts.length : 0;
  }
  return indices;
}

/**
 * Estima etapa atual (0..stages.length-1) pela posição ao longo da polyline.
 */
export function currentStageIndexFromProgress(
  closestVertexIndex: number,
  stageFirstIndices: number[],
  stageCount: number,
): number {
  if (stageCount <= 0) return 0;
  let stage = 0;
  for (let i = 1; i < stageFirstIndices.length; i++) {
    if (closestVertexIndex >= stageFirstIndices[i]) stage = i;
  }
  return Math.min(stage, stageCount - 1);
}

export function summarizeStageForNotification(stage: RouteStageLike, indexOneBased: number): string {
  const mode =
    stage.mode === 'bus' ? 'Ônibus' : stage.mode === 'subway' ? 'Metrô' : 'Caminhada';
  const short = stage.instruction.trim().slice(0, 120);
  const line = short || `${mode} — etapa ${indexOneBased}`;
  return `Próximo passo (${mode}): ${line}`;
}
