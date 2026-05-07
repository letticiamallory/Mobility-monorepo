/**
 * Contratos do "Especialista de acessibilidade de trajetos" (fusão).
 *
 * Política completa: ../../../ACCESSIBILITY_ROUTE_SPECIALIST.md
 * Política de produto: ../../../docs/ACCESSIBILITY_POLICY.md
 *
 * Princípios:
 *  - Nenhuma API é "verdade única": cada leitura vira `Evidence`.
 *  - Falha/timeout NÃO equivale a "acessível": pode virar `unknown` ou penalizar score.
 *  - Avisos (`warning`) em trechos walk derivam da FUSÃO, não exclusivamente do Gemini.
 *  - Sozinho prioriza melhores scores (top-K) com piso configurável; vetos duros só
 *    para casos claramente inaceitáveis.
 */
import type {
  LegAccessibilityConfidence,
  LegAccessibilityBlockerSeverity,
} from './route-accessibility.contract';

/** Origem de uma evidência colhida sobre o trecho. */
export type EvidenceSource =
  | 'overpass'
  | 'ors_wheelchair'
  | 'elevation'
  | 'otp'
  | 'here'
  | 'google'
  | 'gemini_vision'
  | 'structural_engine'
  | 'policy';

/** Estado normalizado por trecho ou rota após a fusão. */
export type AccessibilityState = 'safe' | 'caution' | 'unsafe' | 'unknown';

/** Item canônico do painel de evidências do trecho/rota. */
export interface Evidence {
  source: EvidenceSource;
  /**
   * Tipo da evidência. Ex.: 'stairs_or_steps', 'rough_surface',
   * 'excessive_slope', 'no_wheelchair_route', 'wheelchair_detour',
   * 'image_uncertain', 'transit_not_wheelchair', 'source_skipped'.
   * Não é enum fechado para deixar fontes futuras sem migração.
   */
  kind: string;
  severity: LegAccessibilityBlockerSeverity;
  confidence: LegAccessibilityConfidence;
  /** Mensagem curta em PT-BR (logs / UI avançada). */
  detail?: string;
  metadata?: Record<string, unknown>;
}

/** Sinais brutos coletados em paralelo para um trecho a pé. */
export interface WalkLegSignals {
  /** Se a geometria do trecho era utilizável (`walkSegmentCoordsOk`). */
  walkCoordsOk: boolean;
  /** Inclinação calculada via elevação (% — null quando indisponível). */
  slopePercent: number | null;
  /** Distância declarada do trecho em metros (Google/OTP). */
  declaredWalkMeters: number | null;
  /** Resultado do Overpass (degraus, superfície). */
  overpass?:
    | {
        ok: true;
        stepFeatureCount: number;
        roughSurfaceFeatureCount: number;
      }
    | { ok: false; reason: 'timeout' | 'error'; detail?: string };
  /** Resultado do ORS wheelchair (rota cadeira ou ausência). */
  ors?:
    | { status: 'ok'; distanceMeters: number; durationMinutes: number }
    | { status: 'no_route' }
    | { status: 'skipped'; reason: 'no_key' | 'timeout' | 'error'; detail?: string };
  /** Resultado da análise Gemini de visão (visão é só uma evidência). */
  gemini?:
    | { state: 'safe' | 'unsafe'; confidence: LegAccessibilityConfidence; detail?: string }
    | { state: 'unknown'; reason: 'no_key' | 'no_image' | 'timeout' | 'error' | 'parse_failed' };
  /** Flag wheelchair de leg OTP (quando vier de OTP). */
  otpWheelchair?:
    | { wheelchair: true; accessible: true | false }
    | { wheelchair: false };
}

/** Resultado fusionado por trecho. */
export interface LegFusionResult {
  state: AccessibilityState;
  confidence: LegAccessibilityConfidence;
  /** 0–100, maior = mais acessível. Função pura das `evidences`. */
  score: number;
  /** Texto curto em PT-BR para UI/API (deriva da fusão, não só Gemini). */
  warning: string | null;
  /** Lista plana de mensagens (até N) para UI avançada. */
  alerts: string[];
  /** Origens efetivamente usadas (rastreabilidade). */
  sourcesUsed: EvidenceSource[];
  /** Evidências brutas pós-normalização (debug / observabilidade). */
  evidences: Evidence[];
}

/** Resultado fusionado por rota. */
export interface RouteFusionResult {
  /** 0–100, maior = mais acessível. Composto a partir dos legs. */
  score: number;
  /** Estado agregado da rota (pior dos legs walk relevantes). */
  state: AccessibilityState;
  confidence: LegAccessibilityConfidence;
  /** Decisão de elegibilidade para a aba Sozinho. */
  alone_eligible: boolean;
  /**
   * Motivo curto quando `alone_eligible === false`.
   * Ex.: "Trechos com obstáculos confirmados", "Dados insuficientes".
   */
  companied_recommended_reason: string | null;
  /** Origens distintas usadas em algum leg (telemetria). */
  sourcesUsed: EvidenceSource[];
  /** Resultados detalhados por leg (mesma ordem do `route.stages`). */
  legResults: LegFusionResult[];
  /** Conta de bloqueadores por severidade (debug). */
  blockerCounts: { high: number; medium: number; low: number };
}
