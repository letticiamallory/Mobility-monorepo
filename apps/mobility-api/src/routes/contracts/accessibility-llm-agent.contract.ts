/**
 * Contratos do agente LLM de acessibilidade (Gemini).
 *
 * Especificação completa: ../../../ACCESSIBILITY_LLM_AGENT_SPEC.md
 *
 * Princípios:
 *  - O input ao modelo SEMPRE inclui o painel de evidências completo (várias fontes),
 *    nunca uma fonte só. A ausência de uma fonte vira incerteza, não "tudo acessível".
 *  - O output é estruturado (sem markdown) e validado no backend antes de virar resposta.
 *  - O backend pode aplicar pós-processamento determinístico (clamp 0-100, forçar
 *    `accompanied` quando a fusão já indicou bloqueador grave confirmado, etc).
 */

import type {
  AccessibilityState,
  EvidenceSource,
} from './route-accessibility-fusion.contract';
import type { LegAccessibilityConfidence } from './route-accessibility.contract';

/** Persona do usuário considerada no raciocínio do agente. */
export type AgentPersona = 'low_vision' | 'wheelchair' | 'reduced_mobility';

/** Severidade canônica de um warning emitido pelo agente. */
export type AgentWarningSeverity = 'low' | 'medium' | 'high';

/** Aba em que a rota deve aparecer na UI. */
export type AgentRouteTab = 'alone' | 'accompanied';

/** Painel mínimo que enviamos por leg ao modelo (sem dados pessoais). */
export interface AgentLegPanel {
  stageIndex: number;
  mode: string;
  distance: string | null;
  duration: string | null;
  fusion: {
    state: AccessibilityState;
    confidence: LegAccessibilityConfidence;
    score: number;
    sourcesUsed: EvidenceSource[];
    warning: string | null;
    alerts: string[];
    /** Resumo das evidências (sem `metadata` cru, para não inflar o prompt). */
    evidences: Array<{
      source: EvidenceSource;
      kind: string;
      severity: AgentWarningSeverity;
      confidence: LegAccessibilityConfidence;
      detail?: string;
    }>;
  } | null;
  legacy: {
    accessible: boolean | null;
    slopeWarning: boolean | null;
    warning: string | null;
  };
}

/** Painel por rota (uma das alternativas). */
export interface AgentRoutePanel {
  /** Identificador estável dentro da requisição. */
  routeId: string;
  totalDuration: string | null;
  walkingMinutes: number | null;
  routeFusion: {
    score: number;
    state: AccessibilityState;
    confidence: LegAccessibilityConfidence;
    aloneEligible: boolean;
    sourcesUsed: EvidenceSource[];
    blockerCounts: { high: number; medium: number; low: number };
    companiedReason: string | null;
  } | null;
  legs: AgentLegPanel[];
}

/** Entrada completa enviada ao modelo. */
export interface AccessibilityAgentInput {
  requestId: string;
  userPersona: AgentPersona;
  /** Região/cidade (debug; não muda regras). */
  region: string | null;
  /** Se a chamada usou roteamento dedicado a cadeira de rodas. */
  wheelchairRouting: boolean;
  /** Limiar default usado pelo backend para `tab=alone` (referência ao modelo). */
  aloneMinScore: number;
  routes: AgentRoutePanel[];
}

/** Warning emitido pelo agente (PT-BR, vinculado a stage quando possível). */
export interface AgentWarning {
  stageIndex?: number;
  severity: AgentWarningSeverity;
  message: string;
}

/** Veredito do agente para uma rota. */
export interface AgentRouteVerdict {
  routeId: string;
  /** 0–100. Maior = mais acessível para a persona. */
  accessibilityScore: number;
  tab: AgentRouteTab;
  confidence: LegAccessibilityConfidence;
  warnings: AgentWarning[];
  rationale: string;
  personaNotes?: Partial<Record<AgentPersona, string>>;
}

/** Saída completa do agente. */
export interface AccessibilityAgentOutput {
  schemaVersion: 1;
  routes: AgentRouteVerdict[];
  partitionSummary?: string;
  /** Marca quando o resultado foi montado pelo fallback heurístico (sem LLM). */
  fallback?: boolean;
}
