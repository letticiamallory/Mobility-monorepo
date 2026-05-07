/**
 * Pure helpers used by route-results and fetch-diverse-routes — fully unit-testable.
 */

/** Bloqueador estruturado por trecho — espelha contrato do backend. */
export type RouteLogicBlocker = {
  type?: string;
  severity?: 'low' | 'medium' | 'high';
  detail?: string;
};

export type RouteLogicAccessibilityReport = {
  confidence?: 'low' | 'medium' | 'high';
  blockers?: RouteLogicBlocker[];
  sources?: string[];
};

export type RouteLogicStage = {
  mode?: string;
  duration?: string | number;
  line_code?: string;
  stop_name?: string;
  departure_minutes?: number | string | Array<number | string>;
  accessible?: boolean;
  warning?: string;
  slope_warning?: boolean;
  accessibility_report?: RouteLogicAccessibilityReport;
};

export type RouteLogicItem = {
  total_duration?: string;
  totalDuration?: string;
  totalTime?: string;
  total_distance?: string;
  accessible?: boolean;
  slope_warning?: boolean;
  accompanied?: string;
  companion_mode?: string;
  recommended_for?: string;
  profile?: string;
  search_profile?: 'alone' | 'companied';
  /** 0–100, maior = mais acessível (preenchido pelo backend). */
  accessibility_score?: number;
  stages?: RouteLogicStage[];
};

export type CompanionTab = 'alone' | 'companied';

export function routeDurationMinutes(route: RouteLogicItem): number {
  const value = `${route.total_duration ?? route.totalDuration ?? route.totalTime ?? ''}`;
  const hours = value.match(/(\d+)\s*h/i);
  const minutes = value.match(/(\d+)\s*min/i);
  const fromLabel = (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
  if (fromLabel > 0) return fromLabel;
  const onlyNumber = value.match(/\d+/)?.[0];
  return onlyNumber ? Number(onlyNumber) : 0;
}

export function stageDurationMinutes(stage: RouteLogicStage): number {
  const raw = `${stage.duration ?? ''}`;
  const hours = raw.match(/(\d+)\s*h/i);
  const minutes = raw.match(/(\d+)\s*min/i);
  const fromLabel = (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
  if (fromLabel > 0) return fromLabel;
  const onlyNumber = raw.match(/\d+/)?.[0];
  return onlyNumber ? Number(onlyNumber) : 0;
}

export function normalizeDepartureMinutes(value: RouteLogicStage['departure_minutes']): number | null {
  if (Array.isArray(value)) {
    const firstNumeric = value
      .map((v) => Number(v))
      .find((n) => Number.isFinite(n) && n >= 0);
    return typeof firstNumeric === 'number' ? firstNumeric : null;
  }
  const asNumber = Number(value);
  return Number.isFinite(asNumber) && asNumber >= 0 ? asNumber : null;
}

export function formatClockFromNow(deltaMinutes: number): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + deltaMinutes);
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatClockNow(): string {
  const d = new Date();
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  return `${hh}:${mm}`;
}

export function formatUnixToLocalClock(unixSec: number): string {
  return new Date(unixSec * 1000).toLocaleTimeString('pt-BR', {
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

export function isClock(value?: string): boolean {
  return !!value && /^\d{1,2}:\d{2}$/.test(value.trim());
}

export function addMinutesToClock(clock: string, minutesToAdd: number): string {
  const [h, m] = clock.split(':').map(Number);
  const d = new Date();
  d.setHours(h, m, 0, 0);
  d.setMinutes(d.getMinutes() + minutesToAdd);
  const hh = `${d.getHours()}`.padStart(2, '0');
  const mm = `${d.getMinutes()}`.padStart(2, '0');
  return `${hh}:${mm}`;
}

export function minutesUntilClock(clock: string, now: Date = new Date()): number {
  const [h, m] = clock.split(':').map(Number);
  const target = new Date(now);
  target.setHours(h, m, 0, 0);
  if (target.getTime() < now.getTime()) {
    target.setDate(target.getDate() + 1);
  }
  return Math.max(0, Math.round((target.getTime() - now.getTime()) / 60000));
}

export function isWalkStageMode(mode?: string): boolean {
  const m = `${mode ?? ''}`.toLowerCase().trim();
  return m === 'walk' || m === 'walking' || m === 'foot';
}

export function normalizeStageMode(mode?: string): 'walk' | 'bus' | 'subway' | 'other' {
  const m = `${mode ?? ''}`.toLowerCase();
  if (m === 'walk' || m === 'walking' || m === 'foot') return 'walk';
  if (m.includes('metro') || m.includes('subway') || m === 'rail') return 'subway';
  if (m.includes('bus') || m.includes('onibus')) return 'bus';
  return 'other';
}

export function routeSignature(route: RouteLogicItem): string {
  const modes = (route.stages ?? [])
    .map((s) => {
      const mode = normalizeStageMode(s.mode);
      const line = `${s.line_code ?? ''}`.trim().toLowerCase();
      const stop = `${s.stop_name ?? ''}`.trim().toLowerCase();
      return `${mode}:${line}:${stop}`;
    })
    .join('|');
  const duration = `${route.total_duration ?? route.totalDuration ?? route.totalTime ?? ''}`.trim().toLowerCase();
  const distance = `${route.total_distance ?? ''}`.trim().toLowerCase();
  return `${duration}::${distance}::${modes}`;
}

export function routeTransportFamily(
  route: RouteLogicItem,
): 'walk-only' | 'bus-only' | 'subway-only' | 'combined' | 'other' {
  const set = new Set(
    (route.stages ?? [])
      .map((s) => normalizeStageMode(s.mode))
      .filter((m) => m === 'walk' || m === 'bus' || m === 'subway'),
  );
  const hasWalk = set.has('walk');
  const hasBus = set.has('bus');
  const hasSubway = set.has('subway');
  if (hasWalk && !hasBus && !hasSubway) return 'walk-only';
  if (hasBus && !hasWalk && !hasSubway) return 'bus-only';
  if (hasSubway && !hasWalk && !hasBus) return 'subway-only';
  if ((hasBus || hasSubway) && hasWalk) return 'combined';
  if (hasBus && hasSubway) return 'combined';
  return 'other';
}

export function routeCompanionAudience(route: RouteLogicItem): 'alone' | 'companied' | 'both' | null {
  const sp = route.search_profile;
  if (sp === 'alone') return 'alone';
  if (sp === 'companied') return 'companied';
  const rawValues = [
    route.accompanied,
    route.companion_mode,
    route.recommended_for,
    route.profile,
  ]
    .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map((v) => v.trim().toLowerCase());

  if (rawValues.length === 0) return null;
  const joined = rawValues.join(' ');
  const mentionsBoth =
    joined.includes('both') ||
    joined.includes('ambos') ||
    joined.includes('sozinho e acompanhado');
  const mentionsAlone =
    joined.includes('alone') ||
    joined.includes('solo') ||
    joined.includes('sozinho') ||
    joined.includes('individual');
  const mentionsCompanied =
    joined.includes('companied') ||
    joined.includes('acompanhado') ||
    joined.includes('with companion') ||
    joined.includes('com acompanhante');
  if (mentionsBoth || (mentionsAlone && mentionsCompanied)) return 'both';
  if (mentionsCompanied) return 'companied';
  if (mentionsAlone) return 'alone';
  return null;
}

/** Severidade efetiva do estágio: maior bloqueador estruturado, ou 'medium' se houver warning textual / slope, ou null. */
export function stageMaxSeverity(
  stage: RouteLogicStage,
): 'low' | 'medium' | 'high' | null {
  const blockers = stage.accessibility_report?.blockers ?? [];
  if (blockers.some((b) => b?.severity === 'high')) return 'high';
  if (blockers.some((b) => b?.severity === 'medium')) return 'medium';
  if (stage.accessible === false) return 'high';
  if (stage.slope_warning === true) return 'medium';
  const w = `${stage.warning ?? ''}`.trim();
  if (w.length > 0) return 'medium';
  if (blockers.some((b) => b?.severity === 'low')) return 'low';
  return null;
}

export function stageNeedsAttention(stage: RouteLogicStage): boolean {
  const sev = stageMaxSeverity(stage);
  return sev === 'medium' || sev === 'high';
}

/** Razão principal (texto curto) p/ chip/badge no card; null quando não precisa. */
export function stageAttentionReason(stage: RouteLogicStage): string | null {
  const blockers = stage.accessibility_report?.blockers ?? [];
  const high = blockers.find((b) => b?.severity === 'high');
  const medium = blockers.find((b) => b?.severity === 'medium');
  if (high) return blockerHumanLabel(high) ?? high.detail ?? 'Trecho com obstáculo grave';
  if (medium) return blockerHumanLabel(medium) ?? medium.detail ?? 'Trecho exige atenção';
  if (stage.slope_warning === true) return 'Inclinação acentuada';
  const w = `${stage.warning ?? ''}`.trim();
  if (w.length > 0) return w;
  return null;
}

function blockerHumanLabel(b: RouteLogicBlocker): string | null {
  switch (b.type) {
    case 'stairs_or_steps':
      return 'Escadas/degraus mapeados';
    case 'excessive_slope':
      return 'Inclinação acentuada';
    case 'missing_geometry':
      return 'Sem dados suficientes do trecho';
    case 'rough_surface':
      return 'Calçada ou caminho irregular';
    case 'ors_no_wheelchair_route':
      return 'Rota cadeira não encontrada';
    case 'ors_wheelchair_detour':
      return 'Rota cadeira com desvio longo';
    case 'transit_not_wheelchair':
      return 'Transporte não acessível';
    case 'missing_curb_ramp':
      return 'Sem rampa de meio-fio';
    case 'vision_or_llm_warning':
      return 'Possível obstáculo na imagem';
    default:
      return null;
  }
}

export function isCalmRoute(route: RouteLogicItem): boolean {
  if (route.accessible === false) return false;
  if (route.slope_warning === true) return false;
  const stages = route.stages ?? [];
  return !stages.some((s) => stageNeedsAttention(s) || s.accessible === false);
}

/** True quando a rota merece badge "atenção" no card. */
export function routeNeedsAttention(route: RouteLogicItem): boolean {
  if (route.accessible === false) return true;
  if (route.slope_warning === true) return true;
  const stages = route.stages ?? [];
  return stages.some((s) => stageNeedsAttention(s));
}

/** Razão principal para a rota inteira (do estágio mais severo). */
export function routeAttentionReason(route: RouteLogicItem): string | null {
  const stages = route.stages ?? [];
  let bestSev: 'low' | 'medium' | 'high' | null = null;
  let bestStage: RouteLogicStage | null = null;
  for (const s of stages) {
    const sev = stageMaxSeverity(s);
    if (!sev) continue;
    if (sev === 'high') {
      bestSev = 'high';
      bestStage = s;
      break;
    }
    if (sev === 'medium' && bestSev !== 'medium') {
      bestSev = 'medium';
      bestStage = s;
    } else if (sev === 'low' && !bestSev) {
      bestSev = 'low';
      bestStage = s;
    }
  }
  if (!bestStage) {
    if (route.slope_warning === true) return 'Trajeto com inclinação';
    if (route.accessible === false) return 'Trajeto com obstáculos';
    return null;
  }
  return stageAttentionReason(bestStage);
}

export function routeIncidentCount(route: RouteLogicItem): number {
  const stages = route.stages ?? [];
  let incidents = route.slope_warning === true ? 1 : 0;
  for (const stage of stages) {
    if (stageNeedsAttention(stage)) incidents += 1;
  }
  return incidents;
}

export function routeMatchesCompanionTab(route: RouteLogicItem, tab: CompanionTab): boolean {
  const sp = route.search_profile;
  if (sp === 'alone' || sp === 'companied') {
    return sp === tab;
  }
  if (tab === 'alone') {
    if (route.accessible === false) return false;
    return !routeNeedsAttention(route);
  }
  return true;
}
