/**
 * Agente LLM (Gemini) para partição de rotas — Sozinho × Acompanhado.
 *
 * Especificação completa: ../../ACCESSIBILITY_LLM_AGENT_SPEC.md
 *
 * Fluxo:
 *   1. `buildInput`  monta o painel de evidências (multi-fonte) por rota.
 *   2. `analyze`     chama o Gemini com system instruction de especialista em
 *                    mobilidade urbana + 3 personas; faz parse estrito do JSON.
 *   3. Pós-processamento determinístico: clamp 0–100, força `accompanied`
 *      quando a fusão já indicou bloqueador grave confirmado, e usa o limiar
 *      configurável (`ACCESSIBILITY_AGENT_ALONE_MIN_SCORE`).
 *   4. Em qualquer falha controlada, devolve um fallback heurístico baseado
 *      na fusão atual (sem LLM) — o sistema NÃO regride.
 *
 * Este serviço NÃO é fonte única de verdade: ele complementa
 * `RouteAccessibilityFusionService`, não substitui.
 */

import { Injectable, Logger } from '@nestjs/common';
import type {
  AccessibilityAgentInput,
  AccessibilityAgentOutput,
  AgentLegPanel,
  AgentPersona,
  AgentRoutePanel,
  AgentRouteTab,
  AgentRouteVerdict,
  AgentWarning,
  AgentWarningSeverity,
} from './contracts/accessibility-llm-agent.contract';
import type { LegAccessibilityConfidence } from './contracts/route-accessibility.contract';
import type {
  LegFusionResult,
  RouteFusionResult,
} from './contracts/route-accessibility-fusion.contract';
import type { RouteOption, RouteStage } from './google-routes.service';
import { isWalkStageMode } from './utils/stage-normalization.util';

type AnalyzedRoute = RouteOption & {
  accessibility_fusion?: RouteFusionResult;
};

interface GeminiTextResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{ text?: string }>;
    };
  }>;
}

function readBoolEnv(key: string, defaultValue: boolean): boolean {
  const raw = `${process.env[key] ?? ''}`.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return defaultValue;
}

function readIntEnv(
  key: string,
  defaultValue: number,
  opts?: { min?: number; max?: number },
): number {
  const raw = `${process.env[key] ?? ''}`.trim();
  if (!raw) return defaultValue;
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n)) return defaultValue;
  const min = opts?.min ?? Number.NEGATIVE_INFINITY;
  const max = opts?.max ?? Number.POSITIVE_INFINITY;
  return Math.max(min, Math.min(max, n));
}

const ALLOWED_SEVERITIES: ReadonlySet<AgentWarningSeverity> = new Set([
  'low',
  'medium',
  'high',
]);
const ALLOWED_CONFIDENCES: ReadonlySet<LegAccessibilityConfidence> = new Set([
  'low',
  'medium',
  'high',
]);
const ALLOWED_TABS: ReadonlySet<AgentRouteTab> = new Set(['alone', 'accompanied']);
const ALLOWED_PERSONAS: ReadonlySet<AgentPersona> = new Set([
  'low_vision',
  'wheelchair',
  'reduced_mobility',
]);

const PERSONA_LABEL: Record<AgentPersona, string> = {
  low_vision: 'baixa visão',
  wheelchair: 'cadeirante',
  reduced_mobility: 'mobilidade reduzida',
};

@Injectable()
export class AccessibilityLlmAgentService {
  private readonly logger = new Logger(AccessibilityLlmAgentService.name);

  /** Cabeçalho de system instruction (PT-BR), com especialista + personas + regra multi-fonte. */
  private readonly systemInstruction = [
    'Você é um especialista sênior em mobilidade urbana e acessibilidade,',
    'com prática brasileira em calçadas, transporte coletivo e deslocamento de',
    'pessoas com deficiência ou mobilidade reduzida.',
    '',
    'Você sempre raciocina considerando TRÊS personas:',
    '- low_vision (visão baixa): sinalização tátil/visual, contraste, continuidade',
    '  de piso, cruzamentos previsíveis, informação de paradas e transbordos.',
    '- wheelchair (cadeirante): rampas, desníveis, largura livre, inclinações,',
    '  superfície, obstáculos fixos, acessibilidade declarada do transporte.',
    '- reduced_mobility (mobilidade reduzida): distâncias a pé, pausas, escadas',
    '  vs alternativas, fadiga, segurança em cruzamentos, superfícies irregulares.',
    '',
    'Regras obrigatórias:',
    '1) Você recebe DADOS AGREGADOS DE VÁRIAS FONTES por trecho (OTP, OSM/Overpass,',
    '   ORS wheelchair, elevação, visão computacional, etc.). Nunca presuma que',
    '   uma fonte sozinha é verdade absoluta — INTEGRE todas, declare incertezas',
    '   quando faltar dado e RESERVE Sozinho para casos com evidência convergente.',
    '2) Atribua um score de ACESSIBILIDADE de 0 a 100 (maior = mais acessível)',
    '   priorizando a persona da requisição (`userPersona`) sem ignorar as outras.',
    '3) Marque `tab="alone"` SOMENTE quando o score for confortavelmente acima do',
    '   limiar `aloneMinScore` informado E não houver bloqueador grave confirmado.',
    '   Caso contrário, `tab="accompanied"`.',
    '4) Para cada trecho com inclinação alta, superfície ruim, escadas, bloqueio',
    '   ou conflito entre fontes, gere um WARNING objetivo em PT-BR vinculado ao',
    '   stageIndex correspondente.',
    '5) NUNCA invente normas técnicas que não estejam nos dados.',
    '',
    'Responda EXCLUSIVAMENTE com JSON válido (sem markdown, sem comentários) no',
    'esquema indicado pela API.',
  ].join('\n');

  isEnabled(): boolean {
    if (!readBoolEnv('ACCESSIBILITY_AGENT_ENABLED', true)) return false;
    return `${process.env.GEMINI_API_KEY ?? ''}`.trim().length > 0;
  }

  /** Limiar de score para a aba Sozinho (configurável por env). */
  get aloneMinScore(): number {
    return readIntEnv('ACCESSIBILITY_AGENT_ALONE_MIN_SCORE', 80, {
      min: 0,
      max: 100,
    });
  }

  /** Modelo Gemini usado pela chamada (default alinhado ao `GeminiService`). */
  get model(): string {
    const raw = `${process.env.ACCESSIBILITY_AGENT_MODEL ?? ''}`.trim();
    return raw.length > 0 ? raw : 'gemini-2.5-flash-lite';
  }

  /** Timeout de chamada do agente em ms. */
  get timeoutMs(): number {
    return readIntEnv('ACCESSIBILITY_AGENT_TIMEOUT_MS', 8000, {
      min: 1000,
      max: 30000,
    });
  }

  /**
   * Monta o painel multi-fonte para o agente.
   * Função PURA — só lê os campos já presentes nas rotas analisadas.
   */
  buildInput(
    routes: AnalyzedRoute[],
    persona: AgentPersona,
    options: {
      requestId: string;
      region?: string | null;
      wheelchairRouting?: boolean;
    },
  ): AccessibilityAgentInput {
    const panels: AgentRoutePanel[] = routes.map((route, idx) => {
      const routeId = `r${idx}`;
      const fusion = route.accessibility_fusion ?? null;

      const legs: AgentLegPanel[] = (route.stages ?? []).map((stage, sIdx) => {
        const isWalk = isWalkStageMode(stage.mode);
        const legFusion = isWalk
          ? this.findMatchingLegFusion(fusion, sIdx, stage)
          : null;
        return this.toLegPanel(stage, sIdx, legFusion);
      });

      return {
        routeId,
        totalDuration: route.total_duration ?? null,
        walkingMinutes: this.computeWalkingMinutes(route),
        routeFusion: fusion
          ? {
              score: fusion.score,
              state: fusion.state,
              confidence: fusion.confidence,
              aloneEligible: fusion.alone_eligible,
              sourcesUsed: fusion.sourcesUsed,
              blockerCounts: fusion.blockerCounts,
              companiedReason: fusion.companied_recommended_reason,
            }
          : null,
        legs,
      };
    });

    return {
      requestId: options.requestId,
      userPersona: persona,
      region: options.region ?? null,
      wheelchairRouting: !!options.wheelchairRouting,
      aloneMinScore: this.aloneMinScore,
      routes: panels,
    };
  }

  /**
   * Chama Gemini, faz parse e pós-processa.
   * Em qualquer erro controlado, retorna o fallback heurístico (sem LLM).
   */
  async analyze(
    input: AccessibilityAgentInput,
  ): Promise<AccessibilityAgentOutput> {
    if (input.routes.length === 0) {
      return { schemaVersion: 1, routes: [], fallback: true };
    }

    if (!this.isEnabled()) {
      return this.buildHeuristicFallback(input, 'agent_disabled_or_no_key');
    }

    try {
      const raw = await this.callGemini(input);
      const parsed = this.parseAndValidate(raw, input);
      return this.applyPostProcessing(parsed, input);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[AccessibilityAgent] falhou (${message}), usando fallback heurístico.`,
      );
      return this.buildHeuristicFallback(input, 'llm_error');
    }
  }

  // ---------------------------------------------------------------------------
  // Helpers de montagem do painel
  // ---------------------------------------------------------------------------

  private toLegPanel(
    stage: RouteStage & { accessibility_fusion?: LegFusionResult },
    stageIndex: number,
    legFusion: LegFusionResult | null,
  ): AgentLegPanel {
    const f = legFusion ?? stage.accessibility_fusion ?? null;
    return {
      stageIndex,
      mode: `${stage.mode ?? ''}`,
      distance: stage.distance ?? null,
      duration: stage.duration ?? null,
      fusion: f
        ? {
            state: f.state,
            confidence: f.confidence,
            score: f.score,
            sourcesUsed: f.sourcesUsed,
            warning: f.warning,
            alerts: f.alerts,
            evidences: f.evidences.map((e) => ({
              source: e.source,
              kind: e.kind,
              severity: e.severity,
              confidence: e.confidence,
              detail: e.detail,
            })),
          }
        : null,
      legacy: {
        accessible:
          typeof stage.accessible === 'boolean' ? stage.accessible : null,
        slopeWarning:
          typeof stage.slope_warning === 'boolean' ? stage.slope_warning : null,
        warning: stage.warning ?? null,
      },
    };
  }

  private findMatchingLegFusion(
    routeFusion: RouteFusionResult | null,
    sIdx: number,
    stage: RouteStage & { accessibility_fusion?: LegFusionResult },
  ): LegFusionResult | null {
    if (stage.accessibility_fusion) return stage.accessibility_fusion;
    if (!routeFusion) return null;
    return routeFusion.legResults[sIdx] ?? null;
  }

  private computeWalkingMinutes(route: RouteOption): number | null {
    const stages = route.stages ?? [];
    if (stages.length === 0) return null;
    let total = 0;
    for (const s of stages) {
      if (!isWalkStageMode(s.mode)) continue;
      total += this.parseMinutes(s.duration);
    }
    return total;
  }

  private parseMinutes(value: unknown): number {
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

  // ---------------------------------------------------------------------------
  // Chamada Gemini
  // ---------------------------------------------------------------------------

  private async callGemini(input: AccessibilityAgentInput): Promise<string> {
    const apiKey = `${process.env.GEMINI_API_KEY ?? ''}`.trim();
    if (!apiKey) throw new Error('no_api_key');

    const userPrompt = this.buildUserPrompt(input);

    const body = {
      systemInstruction: {
        parts: [{ text: this.systemInstruction }],
      },
      contents: [
        {
          role: 'user',
          parts: [{ text: userPrompt }],
        },
      ],
      generationConfig: {
        temperature: 0.1,
        responseMimeType: 'application/json',
      },
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-goog-api-key': apiKey,
          },
          body: JSON.stringify(body),
          signal: controller.signal,
        },
      );
    } finally {
      clearTimeout(timeoutId);
    }

    if (!response.ok) {
      const errBody = await response.text().catch(() => '');
      throw new Error(
        `gemini_http_${response.status}_${response.statusText}_${errBody.slice(0, 200)}`,
      );
    }

    const data = (await response.json()) as GeminiTextResponse;
    const text = data.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
    this.logger.log(
      `[AccessibilityAgent] requestId=${input.requestId} model=${this.model} routes=${input.routes.length}`,
    );
    return text;
  }

  private buildUserPrompt(input: AccessibilityAgentInput): string {
    const personaLabel = PERSONA_LABEL[input.userPersona];
    return [
      `Persona do usuário desta requisição: ${input.userPersona} (${personaLabel}).`,
      `Limiar mínimo do backend para tab="alone": ${input.aloneMinScore}.`,
      `Roteamento dedicado a cadeira: ${input.wheelchairRouting ? 'sim' : 'não'}.`,
      input.region ? `Região: ${input.region}.` : '',
      '',
      'PAINEL DE EVIDÊNCIAS (multi-fonte por rota e por leg) — JSON:',
      '```json',
      JSON.stringify(
        { requestId: input.requestId, routes: input.routes },
        null,
        2,
      ),
      '```',
      '',
      'Avalie todas as rotas considerando as três personas, mas priorize a persona da requisição.',
      'Retorne SOMENTE um JSON com este formato exato:',
      '{',
      '  "schemaVersion": 1,',
      '  "routes": [',
      '    {',
      '      "routeId": "<id da rota>",',
      '      "accessibilityScore": <0-100>,',
      '      "tab": "alone" | "accompanied",',
      '      "confidence": "low" | "medium" | "high",',
      '      "warnings": [ { "stageIndex": <int opcional>, "severity": "low"|"medium"|"high", "message": "<PT-BR>" } ],',
      '      "rationale": "<frase curta PT-BR citando a combinação de fontes>",',
      '      "personaNotes": { "low_vision": "...", "wheelchair": "...", "reduced_mobility": "..." }',
      '    }',
      '  ],',
      '  "partitionSummary": "<frase PT-BR opcional resumindo a partição>"',
      '}',
    ]
      .filter(Boolean)
      .join('\n');
  }

  // ---------------------------------------------------------------------------
  // Parse + validação + pós-processamento
  // ---------------------------------------------------------------------------

  private parseAndValidate(
    rawText: string,
    input: AccessibilityAgentInput,
  ): AccessibilityAgentOutput {
    const cleaned = rawText
      .trim()
      .replace(/^```(?:json)?/i, '')
      .replace(/```$/i, '')
      .trim();
    if (!cleaned) throw new Error('empty_response');

    let parsed: unknown;
    try {
      parsed = JSON.parse(cleaned);
    } catch (err) {
      throw new Error(`invalid_json:${(err as Error).message}`);
    }

    if (!parsed || typeof parsed !== 'object') {
      throw new Error('invalid_root_object');
    }
    const obj = parsed as Record<string, unknown>;
    const routesRaw = obj.routes;
    if (!Array.isArray(routesRaw)) throw new Error('missing_routes_array');

    const knownIds = new Set(input.routes.map((r) => r.routeId));
    const verdicts: AgentRouteVerdict[] = [];

    for (const item of routesRaw) {
      if (!item || typeof item !== 'object') continue;
      const r = item as Record<string, unknown>;
      const routeId = typeof r.routeId === 'string' ? r.routeId : null;
      if (!routeId || !knownIds.has(routeId)) continue;

      const scoreRaw = Number(r.accessibilityScore);
      const score = Number.isFinite(scoreRaw)
        ? Math.max(0, Math.min(100, Math.round(scoreRaw)))
        : 0;

      const tab: AgentRouteTab = ALLOWED_TABS.has(r.tab as AgentRouteTab)
        ? (r.tab as AgentRouteTab)
        : 'accompanied';

      const confidence: LegAccessibilityConfidence = ALLOWED_CONFIDENCES.has(
        r.confidence as LegAccessibilityConfidence,
      )
        ? (r.confidence as LegAccessibilityConfidence)
        : 'low';

      const warnings: AgentWarning[] = Array.isArray(r.warnings)
        ? r.warnings
            .map((w) => this.coerceWarning(w))
            .filter((w): w is AgentWarning => w !== null)
        : [];

      const personaNotesRaw = r.personaNotes;
      const personaNotes: AgentRouteVerdict['personaNotes'] = {};
      if (personaNotesRaw && typeof personaNotesRaw === 'object') {
        for (const [k, v] of Object.entries(personaNotesRaw)) {
          if (
            ALLOWED_PERSONAS.has(k as AgentPersona) &&
            typeof v === 'string' &&
            v.trim().length > 0
          ) {
            personaNotes[k as AgentPersona] = v.trim();
          }
        }
      }

      verdicts.push({
        routeId,
        accessibilityScore: score,
        tab,
        confidence,
        warnings,
        rationale:
          typeof r.rationale === 'string' && r.rationale.trim().length > 0
            ? r.rationale.trim()
            : 'Sem rationale fornecido pelo modelo.',
        personaNotes:
          Object.keys(personaNotes).length > 0 ? personaNotes : undefined,
      });
    }

    if (verdicts.length === 0) throw new Error('no_valid_route_verdicts');

    const partitionSummary =
      typeof obj.partitionSummary === 'string'
        ? obj.partitionSummary.trim()
        : undefined;

    return {
      schemaVersion: 1,
      routes: verdicts,
      partitionSummary: partitionSummary || undefined,
    };
  }

  private coerceWarning(raw: unknown): AgentWarning | null {
    if (!raw || typeof raw !== 'object') return null;
    const w = raw as Record<string, unknown>;
    const message = typeof w.message === 'string' ? w.message.trim() : '';
    if (!message) return null;
    const severity: AgentWarningSeverity = ALLOWED_SEVERITIES.has(
      w.severity as AgentWarningSeverity,
    )
      ? (w.severity as AgentWarningSeverity)
      : 'medium';
    const stageIndexRaw = Number(w.stageIndex);
    const stageIndex = Number.isInteger(stageIndexRaw) && stageIndexRaw >= 0
      ? stageIndexRaw
      : undefined;
    return { stageIndex, severity, message };
  }

  /**
   * Pós-processamento determinístico:
   *  - Garante que rotas com bloqueador HIGH confirmado pela fusão NÃO vão para `alone`.
   *  - Garante que score abaixo do limiar => `accompanied`.
   *  - Garante que toda rota presente no input apareça no output (preenche faltantes
   *    com fallback heurístico).
   */
  applyPostProcessing(
    output: AccessibilityAgentOutput,
    input: AccessibilityAgentInput,
  ): AccessibilityAgentOutput {
    const byId = new Map(output.routes.map((r) => [r.routeId, r]));
    const finalVerdicts: AgentRouteVerdict[] = [];

    for (const panel of input.routes) {
      const verdict = byId.get(panel.routeId);
      if (verdict) {
        finalVerdicts.push(this.applyRouteSafetyRules(verdict, panel, input));
      } else {
        finalVerdicts.push(this.heuristicVerdictForPanel(panel, input));
      }
    }

    return {
      schemaVersion: 1,
      routes: finalVerdicts,
      partitionSummary: output.partitionSummary,
      fallback: output.fallback,
    };
  }

  private applyRouteSafetyRules(
    verdict: AgentRouteVerdict,
    panel: AgentRoutePanel,
    input: AccessibilityAgentInput,
  ): AgentRouteVerdict {
    const next: AgentRouteVerdict = { ...verdict };

    next.accessibilityScore = Math.max(
      0,
      Math.min(100, Math.round(next.accessibilityScore)),
    );

    const fusion = panel.routeFusion;
    const blockedByFusion =
      fusion !== null &&
      (fusion.aloneEligible === false ||
        fusion.blockerCounts.high > 0 ||
        fusion.state === 'unsafe');

    if (blockedByFusion && next.tab === 'alone') {
      next.tab = 'accompanied';
      next.warnings = [
        ...next.warnings,
        {
          severity: 'high',
          message:
            fusion?.companiedReason ??
            'Fusão de evidências indicou bloqueador grave: rota recomendada com acompanhamento.',
        },
      ];
    }

    if (next.tab === 'alone' && next.accessibilityScore < input.aloneMinScore) {
      next.tab = 'accompanied';
    }

    return next;
  }

  // ---------------------------------------------------------------------------
  // Fallback heurístico (sem LLM)
  // ---------------------------------------------------------------------------

  private buildHeuristicFallback(
    input: AccessibilityAgentInput,
    reason: string,
  ): AccessibilityAgentOutput {
    return {
      schemaVersion: 1,
      routes: input.routes.map((p) => this.heuristicVerdictForPanel(p, input)),
      partitionSummary: `Partição calculada por fallback heurístico (${reason}).`,
      fallback: true,
    };
  }

  private heuristicVerdictForPanel(
    panel: AgentRoutePanel,
    input: AccessibilityAgentInput,
  ): AgentRouteVerdict {
    const fusion = panel.routeFusion;
    const score = fusion?.score ?? 50;
    const tab: AgentRouteTab =
      fusion?.aloneEligible &&
      score >= input.aloneMinScore &&
      fusion.state !== 'unsafe' &&
      fusion.blockerCounts.high === 0
        ? 'alone'
        : 'accompanied';

    const warnings: AgentWarning[] = [];
    for (const leg of panel.legs) {
      const f = leg.fusion;
      if (!f || !f.warning) continue;
      warnings.push({
        stageIndex: leg.stageIndex,
        severity:
          f.state === 'unsafe' ? 'high' : f.state === 'caution' ? 'medium' : 'low',
        message: f.warning,
      });
    }

    return {
      routeId: panel.routeId,
      accessibilityScore: Math.max(0, Math.min(100, Math.round(score))),
      tab,
      confidence: fusion?.confidence ?? 'low',
      warnings,
      rationale:
        fusion?.companiedReason ??
        'Decisão derivada da fusão de evidências do backend (sem LLM).',
      personaNotes: {
        [input.userPersona]: `Avaliação considerando persona ${PERSONA_LABEL[input.userPersona]}.`,
      },
    };
  }
}
