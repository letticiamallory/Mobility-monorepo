/**
 * Pontuação 0–100 e partição Sozinho/Acompanhado.
 *
 * Regra de produto (ver `docs/ACCESSIBILITY_POLICY.md`):
 *  - score 100 → mais acessível (com base nos dados que temos);
 *  - Sozinho = top-N rotas com `score >= ROUTES_ALONE_MIN_SCORE` **e** sem bloqueador `high`
 *    **e** todos os trechos walk com geometria utilizável.
 *  - Acompanhado = todas as restantes (incluindo as com bloqueadores `high`).
 *  - Abas sempre disjuntas.
 */

import type { LegAccessibilityReport } from '../contracts/route-accessibility.contract';
import type {
  LegFusionResult,
  RouteFusionResult,
} from '../contracts/route-accessibility-fusion.contract';
import { isWalkStageMode, walkSegmentCoordsOk } from './stage-normalization.util';

export type ScoredRouteStage = {
  mode?: string;
  warning?: string | null;
  accessible?: boolean;
  slope_warning?: boolean;
  duration?: string;
  location?: { lat: number; lng: number } | null;
  end_location?: { lat: number; lng: number } | null;
  accessibility_report?: LegAccessibilityReport;
  /** Resultado fusionado por trecho (Fase 4). Opcional para compatibilidade. */
  accessibility_fusion?: LegFusionResult;
};

export type ScoredRoute = {
  accessible?: boolean;
  slope_warning?: boolean;
  total_duration?: string;
  stages?: ScoredRouteStage[];
  /** Resultado fusionado por rota (Fase 4). Opcional para compatibilidade. */
  accessibility_fusion?: RouteFusionResult;
};

function readIntFromEnv(key: string, defaultVal: number, opts?: { min?: number; max?: number }): number {
  const raw = `${process.env[key] ?? ''}`.trim();
  if (!raw) return defaultVal;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return defaultVal;
  const min = opts?.min ?? Number.NEGATIVE_INFINITY;
  const max = opts?.max ?? Number.POSITIVE_INFINITY;
  return Math.max(min, Math.min(max, n));
}

export const ROUTES_ALONE_MIN_SCORE = readIntFromEnv('ROUTES_ALONE_MIN_SCORE', 80, {
  min: 0,
  max: 100,
});

export const ROUTES_ALONE_MAX = readIntFromEnv('ROUTES_ALONE_MAX', 3, { min: 1, max: 6 });
export const ROUTES_COMPANIED_MAX = readIntFromEnv('ROUTES_COMPANIED_MAX', 3, { min: 1, max: 6 });

const SEVERITY_PENALTY: Record<'low' | 'medium' | 'high', number> = {
  low: 3,
  medium: 12,
  high: 25,
};

const POSITIVE_SOURCES = new Set([
  'ors_wheelchair',
  'otp_wheelchair_flag',
  'overpass_steps',
  'elevation_slope',
]);

function parseMinutes(value: unknown): number {
  if (typeof value !== 'string' && typeof value !== 'number') return 0;
  const text = String(value).trim().toLowerCase();
  if (!text) return 0;
  const hours = text.match(/(\d+)\s*h/);
  const minutes = text.match(/(\d+)\s*min/);
  const total = (hours ? Number(hours[1]) * 60 : 0) + (minutes ? Number(minutes[1]) : 0);
  if (total > 0) return total;
  const fallback = Number.parseInt(text, 10);
  return Number.isFinite(fallback) ? fallback : 0;
}

export function walkingMinutes(route: ScoredRoute): number {
  return (route.stages ?? [])
    .filter((s) => isWalkStageMode(s.mode))
    .reduce((acc, s) => acc + parseMinutes(s.duration), 0);
}

/** Conta bloqueadores por severidade somando todos os estágios. */
export function countBlockerSeverities(route: ScoredRoute): {
  high: number;
  medium: number;
  low: number;
} {
  let high = 0;
  let medium = 0;
  let low = 0;
  for (const stage of route.stages ?? []) {
    const blockers = stage.accessibility_report?.blockers ?? [];
    for (const b of blockers) {
      if (b.severity === 'high') high += 1;
      else if (b.severity === 'medium') medium += 1;
      else if (b.severity === 'low') low += 1;
    }
  }
  return { high, medium, low };
}

export function hasHighBlocker(route: ScoredRoute): boolean {
  return countBlockerSeverities(route).high > 0;
}

export function hasInvalidWalkGeometry(route: ScoredRoute): boolean {
  for (const s of route.stages ?? []) {
    if (!isWalkStageMode(s.mode)) continue;
    if (!walkSegmentCoordsOk(s)) return true;
  }
  return false;
}

/**
 * Score 0–100 — maior = mais acessível.
 *
 *  - Se a rota tiver `accessibility_fusion` (Fase 4), o score fusionado é o **eixo principal**
 *    e o score legado entra com peso menor para preservar desempates históricos
 *    (tempo de caminhada, flags accessible/slope).
 *  - Sem fusão (compat), o cálculo legado continua valendo integralmente.
 */
export function computeAccessibilityScore(route: ScoredRoute): number {
  const legacy = computeLegacyScore(route);
  const fusion = route.accessibility_fusion?.score;
  if (typeof fusion === 'number' && Number.isFinite(fusion)) {
    // Blend: 70% fusão (eixo principal) + 30% legado (desempate por minutos a pé etc.).
    return Math.max(0, Math.min(100, Math.round(fusion * 0.7 + legacy * 0.3)));
  }
  return legacy;
}

function computeLegacyScore(route: ScoredRoute): number {
  let score = 100;

  if (route.accessible === false) score -= 25;
  if (route.slope_warning === true) score -= 20;

  for (const stage of route.stages ?? []) {
    if (!isWalkStageMode(stage.mode)) continue;
    if (stage.accessible === false) score -= 22;
    if (stage.slope_warning === true) score -= 16;
    const w = `${stage.warning ?? ''}`.trim();
    if (w.length > 0) score -= 14;
  }

  const sevCounts = countBlockerSeverities(route);
  score -= sevCounts.high * SEVERITY_PENALTY.high;
  score -= sevCounts.medium * SEVERITY_PENALTY.medium;
  score -= sevCounts.low * SEVERITY_PENALTY.low;

  const positiveSources = new Set<string>();
  for (const stage of route.stages ?? []) {
    for (const src of stage.accessibility_report?.sources ?? []) {
      if (POSITIVE_SOURCES.has(src)) positiveSources.add(src);
    }
  }
  score += Math.min(5, positiveSources.size);

  const walkM = walkingMinutes(route);
  score -= Math.min(15, Math.floor(walkM / 4));

  return Math.max(0, Math.min(100, Math.round(score)));
}

export type Partitioned<T extends ScoredRoute> = {
  alone: Array<T & { accessibility_score: number }>;
  companied: Array<T & { accessibility_score: number }>;
};

/**
 * Particiona em duas listas **disjuntas**:
 *  - Sozinho: score 80–100 (inclusivo)
 *  - Acompanhado: score 60–79 (inclusivo)
 *  - Abaixo de 60: não entra em nenhuma aba
 * Em ambas, ordenação primária por score desc, desempate por duração asc.
 */
export function partitionRoutesByScore<T extends ScoredRoute>(
  routes: T[],
  // `options` mantido por compat (não usado na regra por faixa).
  options?: { aloneMax?: number; companiedMax?: number; minScoreAlone?: number },
): Partitioned<T> {
  const scored = routes.map((r) => ({
    ...r,
    accessibility_score: computeAccessibilityScore(r),
  })) as Array<T & { accessibility_score: number }>;

  const sortFn = (a: T & { accessibility_score: number }, b: T & { accessibility_score: number }) => {
    if (b.accessibility_score !== a.accessibility_score) {
      return b.accessibility_score - a.accessibility_score;
    }
    return parseMinutes(a.total_duration) - parseMinutes(b.total_duration);
  };

  // Regra por FAIXA (produto): qualquer rota dentro da faixa entra.
  const aloneCandidates = scored
    .filter((r) => r.accessibility_score >= 80 && r.accessibility_score <= 100)
    .sort(sortFn);

  const companiedCandidates = scored
    .filter((r) => r.accessibility_score >= 60 && r.accessibility_score <= 79)
    .sort(sortFn);

  if (
    aloneCandidates.length === 0 &&
    companiedCandidates.length === 0 &&
    scored.length > 0
  ) {
    // Pontuação fusionada/legada pode deixar todas as rotas abaixo de 60 — antes sumiam
    // das duas abas e a API devolvia lista vazia. Ainda mostramos as melhores opções.
    const sorted = [...scored].sort(sortFn);
    return {
      alone: [],
      companied: sorted.slice(0, ROUTES_COMPANIED_MAX),
    };
  }

  return {
    alone: aloneCandidates,
    companied: companiedCandidates,
  };
}
