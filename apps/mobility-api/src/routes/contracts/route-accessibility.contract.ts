/**
 * Contratos estáveis para acessibilidade e telemetria de rota.
 * Política de negócio: docs/ACCESSIBILITY_POLICY.md
 */

/** Perfil de busca exposto ao cliente (abas Sozinho / Acompanhado). */
export type SearchProfile = 'alone' | 'companied';

/**
 * Confiança da análise estruturada de um trecho a pé (Fase 1+).
 * Fase 0: tipos reservados; o motor ainda pode preencher gradualmente.
 */
export type LegAccessibilityConfidence = 'high' | 'medium' | 'low';

/** Severidade de um bloqueador declarado pelo motor de acessibilidade. */
export type LegAccessibilityBlockerSeverity = 'low' | 'medium' | 'high';

/** Tipos de bloqueador (extensível nas fases seguintes). */
export type LegAccessibilityBlockerType =
  | 'missing_geometry'
  | 'stairs_or_steps'
  | 'excessive_slope'
  | 'rough_surface'
  | 'missing_curb_ramp'
  | 'vision_or_llm_warning'
  | 'transit_not_wheelchair'
  /** ORS wheelchair não retornou rota entre os extremos (com API key válida). Fase 2. */
  | 'ors_no_wheelchair_route'
  /** Rota wheelchair do ORS muito mais longa que a distância declarada no trecho (heurística). Fase 3 — severidade baixa. */
  | 'ors_wheelchair_detour'
  | 'unknown'
  | 'other';

/** Um problema identificado ao longo do trecho (Fase 1+). */
export interface LegAccessibilityBlocker {
  type: LegAccessibilityBlockerType;
  severity: LegAccessibilityBlockerSeverity;
  /** Mensagem curta para logs ou UI avançada; opcional. */
  detail?: string;
}

/**
 * Relatório por trecho a pé — alvo do AccessibilityEngine nas fases 1–2.
 * Fase 0: estrutura oficial; campos opcionais até o motor popular.
 */
export interface LegAccessibilityReport {
  /** Índice do estágio na rota (0-based), se aplicável. */
  stageIndex?: number;
  confidence: LegAccessibilityConfidence;
  blockers: LegAccessibilityBlocker[];
  /** Metadados de provedor para telemetria (ex.: overpass, ors, elevation). */
  sources?: string[];
}

/** Agregado opcional por rota inteira (futuro). */
export interface RouteAccessibilitySummary {
  searchProfileEligible: SearchProfile;
  legReports: LegAccessibilityReport[];
  /** ISO-8601 ou timestamp ms — quando o relatório foi montado. */
  evaluatedAt?: string;
}
