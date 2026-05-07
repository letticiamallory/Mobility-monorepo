/**
 * Testes do AccessibilityLlmAgentService.
 *
 * Cobertura:
 *  - `buildInput` consolida o painel multi-fonte (mesmo com 1 fonte ausente).
 *  - `analyze` faz parse do JSON, valida e aplica pós-processamento determinístico.
 *  - Pós-processamento força `accompanied` quando a fusão indica bloqueador grave,
 *    mesmo que o LLM tenha sugerido `alone` (defesa em profundidade).
 *  - Fallback heurístico quando o agente está desabilitado (sem GEMINI_API_KEY)
 *    ou quando a resposta do modelo não pode ser parseada.
 *  - O prompt enviado ao Gemini contém o painel de evidências (multi-fonte) e a
 *    persona da requisição.
 */

import { AccessibilityLlmAgentService } from './accessibility-llm-agent.service';
import type {
  RouteFusionResult,
  LegFusionResult,
} from './contracts/route-accessibility-fusion.contract';
import type { RouteOption } from './google-routes.service';

type AnalyzedRoute = RouteOption & {
  accessibility_fusion?: RouteFusionResult;
};

function makeFusionLeg(overrides: Partial<LegFusionResult> = {}): LegFusionResult {
  return {
    state: 'safe',
    confidence: 'high',
    score: 90,
    warning: null,
    alerts: [],
    sourcesUsed: ['overpass', 'elevation'],
    evidences: [],
    ...overrides,
  };
}

function makeFusionRoute(overrides: Partial<RouteFusionResult> = {}): RouteFusionResult {
  return {
    score: 80,
    state: 'safe',
    confidence: 'high',
    alone_eligible: true,
    companied_recommended_reason: null,
    sourcesUsed: ['overpass', 'elevation'],
    legResults: [makeFusionLeg()],
    blockerCounts: { high: 0, medium: 0, low: 0 },
    ...overrides,
  };
}

function makeAnalyzedRoute(
  overrides: Partial<AnalyzedRoute> = {},
): AnalyzedRoute {
  return {
    total_duration: '20 min',
    accessible: true,
    stages: [
      {
        mode: 'walk',
        distance: '300 m',
        duration: '5 min',
        location: { lat: -23.55, lng: -46.63 },
        end_location: { lat: -23.551, lng: -46.631 },
        accessible: true,
        slope_warning: false,
        warning: null,
      } as any,
    ],
    accessibility_fusion: makeFusionRoute(),
    ...overrides,
  } as AnalyzedRoute;
}

const ORIGINAL_ENV = process.env;

describe('AccessibilityLlmAgentService', () => {
  let svc: AccessibilityLlmAgentService;

  beforeEach(() => {
    process.env = { ...ORIGINAL_ENV };
    svc = new AccessibilityLlmAgentService();
  });

  afterEach(() => {
    process.env = ORIGINAL_ENV;
    jest.restoreAllMocks();
  });

  describe('isEnabled / configuração', () => {
    it('retorna false quando não há GEMINI_API_KEY', () => {
      delete process.env.GEMINI_API_KEY;
      expect(svc.isEnabled()).toBe(false);
    });

    it('retorna false quando ACCESSIBILITY_AGENT_ENABLED=false', () => {
      process.env.GEMINI_API_KEY = 'k';
      process.env.ACCESSIBILITY_AGENT_ENABLED = 'false';
      expect(svc.isEnabled()).toBe(false);
    });

    it('retorna true com chave e flag default', () => {
      process.env.GEMINI_API_KEY = 'k';
      delete process.env.ACCESSIBILITY_AGENT_ENABLED;
      expect(svc.isEnabled()).toBe(true);
    });

    it('aloneMinScore respeita ACCESSIBILITY_AGENT_ALONE_MIN_SCORE', () => {
      process.env.ACCESSIBILITY_AGENT_ALONE_MIN_SCORE = '85';
      expect(svc.aloneMinScore).toBe(85);
    });
  });

  describe('buildInput', () => {
    it('inclui painel multi-fonte com legs e fusão por rota', () => {
      const route = makeAnalyzedRoute();
      const input = svc.buildInput([route], 'wheelchair', {
        requestId: 'rq1',
        wheelchairRouting: true,
      });
      expect(input.userPersona).toBe('wheelchair');
      expect(input.wheelchairRouting).toBe(true);
      expect(input.routes).toHaveLength(1);
      expect(input.routes[0].routeId).toBe('r0');
      expect(input.routes[0].routeFusion?.score).toBe(80);
      expect(input.routes[0].legs[0].fusion?.sourcesUsed).toContain('overpass');
    });

    it('aceita rota sem fusion sem quebrar (rota legada)', () => {
      const route = makeAnalyzedRoute({ accessibility_fusion: undefined });
      const input = svc.buildInput([route], 'low_vision', { requestId: 'rq2' });
      expect(input.routes[0].routeFusion).toBeNull();
      expect(input.routes[0].legs[0].fusion).toBeNull();
    });
  });

  describe('analyze — fallback', () => {
    it('usa fallback heurístico quando agente está desabilitado', async () => {
      delete process.env.GEMINI_API_KEY;
      const route = makeAnalyzedRoute();
      const input = svc.buildInput([route], 'reduced_mobility', {
        requestId: 'rq',
      });
      const out = await svc.analyze(input);
      expect(out.fallback).toBe(true);
      expect(out.routes).toHaveLength(1);
      expect(out.routes[0].tab).toBe('alone');
      expect(out.routes[0].accessibilityScore).toBe(80);
    });

    it('fallback marca accompanied quando fusion bloqueia', async () => {
      delete process.env.GEMINI_API_KEY;
      const route = makeAnalyzedRoute({
        accessibility_fusion: makeFusionRoute({
          score: 40,
          state: 'unsafe',
          alone_eligible: false,
          blockerCounts: { high: 2, medium: 1, low: 0 },
          companied_recommended_reason: 'Trecho com obstáculo grave confirmado.',
        }),
      });
      const input = svc.buildInput([route], 'wheelchair', { requestId: 'rq' });
      const out = await svc.analyze(input);
      expect(out.fallback).toBe(true);
      expect(out.routes[0].tab).toBe('accompanied');
      expect(out.routes[0].rationale).toContain('Trecho com obstáculo grave');
    });
  });

  describe('analyze — chamada Gemini com mock', () => {
    function mockGeminiJson(payload: unknown): jest.SpyInstance {
      const response = {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          candidates: [
            { content: { parts: [{ text: JSON.stringify(payload) }] } },
          ],
        }),
        text: async () => '',
      } as unknown as Response;
      return jest
        .spyOn(globalThis, 'fetch')
        .mockResolvedValue(response as never);
    }

    it('faz parse, valida e respeita o tab sugerido pelo modelo', async () => {
      process.env.GEMINI_API_KEY = 'k';
      const spy = mockGeminiJson({
        schemaVersion: 1,
        routes: [
          {
            routeId: 'r0',
            accessibilityScore: 88,
            tab: 'alone',
            confidence: 'high',
            warnings: [],
            rationale: 'Combinação de Overpass + elevação indicou trajeto limpo.',
            personaNotes: { wheelchair: 'Sem desníveis relevantes.' },
          },
        ],
        partitionSummary: '1 rota Sozinho.',
      });
      const route = makeAnalyzedRoute();
      const input = svc.buildInput([route], 'wheelchair', { requestId: 'rq' });
      const out = await svc.analyze(input);

      expect(spy).toHaveBeenCalledTimes(1);
      const callArgs = spy.mock.calls[0];
      const url = callArgs[0] as string;
      expect(url).toContain('generateContent');
      const body = JSON.parse(((callArgs[1] as RequestInit).body as string) ?? '{}');
      const userText = body.contents[0].parts[0].text as string;
      expect(userText).toContain('wheelchair');
      expect(userText).toContain('"routeId": "r0"');

      expect(out.fallback).toBeFalsy();
      expect(out.routes[0].tab).toBe('alone');
      expect(out.routes[0].accessibilityScore).toBe(88);
      expect(out.routes[0].personaNotes?.wheelchair).toContain('Sem desníveis');
    });

    it('força accompanied quando fusão tem bloqueador grave, mesmo se LLM disser alone', async () => {
      process.env.GEMINI_API_KEY = 'k';
      mockGeminiJson({
        schemaVersion: 1,
        routes: [
          {
            routeId: 'r0',
            accessibilityScore: 95,
            tab: 'alone',
            confidence: 'high',
            warnings: [],
            rationale: 'Modelo achou tudo ok.',
          },
        ],
      });
      const route = makeAnalyzedRoute({
        accessibility_fusion: makeFusionRoute({
          state: 'unsafe',
          alone_eligible: false,
          blockerCounts: { high: 2, medium: 0, low: 0 },
          companied_recommended_reason: 'Degrau alto confirmado em duas fontes.',
        }),
      });
      const input = svc.buildInput([route], 'wheelchair', { requestId: 'rq' });
      const out = await svc.analyze(input);
      expect(out.routes[0].tab).toBe('accompanied');
      expect(out.routes[0].warnings.some((w) => w.severity === 'high')).toBe(true);
    });

    it('usa fallback quando JSON é inválido', async () => {
      process.env.GEMINI_API_KEY = 'k';
      const response = {
        ok: true,
        status: 200,
        statusText: 'OK',
        json: async () => ({
          candidates: [{ content: { parts: [{ text: 'not json {' }] } }],
        }),
        text: async () => '',
      } as unknown as Response;
      jest.spyOn(globalThis, 'fetch').mockResolvedValue(response as never);

      const input = svc.buildInput([makeAnalyzedRoute()], 'wheelchair', {
        requestId: 'rq',
      });
      const out = await svc.analyze(input);
      expect(out.fallback).toBe(true);
      expect(out.routes).toHaveLength(1);
    });

    it('preenche rotas faltantes no output do LLM via fallback heurístico', async () => {
      process.env.GEMINI_API_KEY = 'k';
      mockGeminiJson({
        schemaVersion: 1,
        routes: [
          {
            routeId: 'r0',
            accessibilityScore: 80,
            tab: 'alone',
            confidence: 'high',
            warnings: [],
            rationale: 'ok',
          },
        ],
      });
      const input = svc.buildInput(
        [makeAnalyzedRoute(), makeAnalyzedRoute({ total_duration: '40 min' })],
        'wheelchair',
        { requestId: 'rq' },
      );
      const out = await svc.analyze(input);
      expect(out.routes).toHaveLength(2);
      expect(out.routes[1].routeId).toBe('r1');
    });
  });
});
