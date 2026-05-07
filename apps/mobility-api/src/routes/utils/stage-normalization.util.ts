/**
 * Normalização de modos “a pé” entre provedores (Google, OTP, HERE).
 * Única fonte de verdade para classificação de trechos walk nos serviços de rota.
 */

export interface WalkStageCoords {
  mode?: unknown;
  location?: { lat: number; lng: number } | null;
  end_location?: { lat: number; lng: number } | null;
}

export function isWalkStageMode(mode: unknown): boolean {
  const m = `${mode ?? ''}`.toLowerCase().trim();
  return m === 'walk' || m === 'walking' || m === 'foot';
}

/**
 * Modo canônico persistido / exibido após normalização.
 */
export function normalizeWalkStageMode(mode: unknown): 'walk' | null {
  return isWalkStageMode(mode) ? 'walk' : null;
}

/** Geometria mínima para elevação / análise estruturada do trecho a pé. */
export function walkSegmentCoordsOk(stage: WalkStageCoords): boolean {
  return (
    isWalkStageMode(stage.mode) &&
    stage.location != null &&
    stage.end_location != null &&
    Number.isFinite(stage.location.lat) &&
    Number.isFinite(stage.location.lng) &&
    Number.isFinite(stage.end_location.lat) &&
    Number.isFinite(stage.end_location.lng)
  );
}
