import {
  computeAccessibilityScore,
  hasHighBlocker,
  partitionRoutesByScore,
  ROUTES_ALONE_MIN_SCORE,
} from './route-scoring.util';

describe('route-scoring.util', () => {
  const walk = (overrides: Record<string, unknown> = {}) => ({
    mode: 'walk',
    accessible: true,
    warning: null,
    slope_warning: false,
    duration: '5 min',
    location: { lat: -23.55, lng: -46.63 },
    end_location: { lat: -23.551, lng: -46.631 },
    ...overrides,
  });

  it('rota limpa pontua perto de 100', () => {
    const route = { accessible: true, slope_warning: false, stages: [walk()] };
    expect(computeAccessibilityScore(route)).toBeGreaterThanOrEqual(95);
  });

  it('penaliza bloqueadores por severidade', () => {
    const high = computeAccessibilityScore({
      accessible: true,
      slope_warning: false,
      stages: [
        walk({
          accessibility_report: {
            confidence: 'high',
            blockers: [{ type: 'stairs_or_steps', severity: 'high' }],
          },
        }),
      ],
    });
    const med = computeAccessibilityScore({
      accessible: true,
      slope_warning: false,
      stages: [
        walk({
          accessibility_report: {
            confidence: 'medium',
            blockers: [{ type: 'rough_surface', severity: 'medium' }],
          },
        }),
      ],
    });
    const low = computeAccessibilityScore({
      accessible: true,
      slope_warning: false,
      stages: [
        walk({
          accessibility_report: {
            confidence: 'high',
            blockers: [{ type: 'ors_wheelchair_detour', severity: 'low' }],
          },
        }),
      ],
    });
    expect(high).toBeLessThan(med);
    expect(med).toBeLessThan(low);
  });

  it('score de rota com warning textual em walk fica abaixo de rota limpa', () => {
    const dirty = computeAccessibilityScore({
      accessible: true,
      slope_warning: false,
      stages: [walk({ warning: 'Trecho com inclinacao 9% (acima de 8%).' })],
    });
    const clean = computeAccessibilityScore({
      accessible: true,
      slope_warning: false,
      stages: [walk()],
    });
    expect(dirty).toBeLessThan(clean);
  });

  it('partição: rota com bloqueador high vai para Acompanhado mesmo com score alto', () => {
    const routes = [
      {
        accessible: true,
        slope_warning: false,
        total_duration: '15 min',
        stages: [
          walk({
            accessibility_report: {
              confidence: 'high',
              blockers: [{ type: 'stairs_or_steps', severity: 'high' }],
            },
          }),
        ],
      },
    ];
    const part = partitionRoutesByScore(routes);
    expect(part.alone).toHaveLength(0);
    expect(part.companied).toHaveLength(1);
  });

  it('partição: as duas listas são sempre disjuntas', () => {
    const routes = [
      { accessible: true, slope_warning: false, total_duration: '10 min', stages: [walk()] },
      { accessible: true, slope_warning: false, total_duration: '15 min', stages: [walk()] },
      {
        accessible: false,
        slope_warning: false,
        total_duration: '5 min',
        stages: [walk({ accessible: false, warning: 'obstaculo' })],
      },
    ];
    const part = partitionRoutesByScore(routes);
    const aloneSet = new Set(part.alone);
    const intersection = part.companied.filter((r) => aloneSet.has(r));
    expect(intersection).toHaveLength(0);
  });

  it('hasHighBlocker detecta apenas severity high', () => {
    expect(
      hasHighBlocker({
        stages: [
          {
            mode: 'walk',
            accessibility_report: {
              confidence: 'medium',
              blockers: [{ type: 'rough_surface', severity: 'medium' }],
            },
          },
        ],
      }),
    ).toBe(false);
    expect(
      hasHighBlocker({
        stages: [
          {
            mode: 'walk',
            accessibility_report: {
              confidence: 'high',
              blockers: [{ type: 'stairs_or_steps', severity: 'high' }],
            },
          },
        ],
      }),
    ).toBe(true);
  });

  it('partition: faixas de score definem aba (Sozinho 80–100)', () => {
    const route = {
      accessible: true,
      slope_warning: false,
      total_duration: '12 min',
      stages: [walk()],
      accessibility_fusion: {
        score: 90,
        state: 'caution' as const,
        confidence: 'low' as const,
        alone_eligible: false,
        companied_recommended_reason: 'Dados insuficientes',
        sourcesUsed: [],
        legResults: [],
        blockerCounts: { high: 0, medium: 0, low: 0 },
      },
    };
    const part = partitionRoutesByScore([route]);
    expect(part.alone).toHaveLength(1);
    expect(part.companied).toHaveLength(0);
  });

  it('score fusionado é o eixo principal: empurra rotas ruins para baixo do piso', () => {
    const noisyStages = [
      walk({
        warning: 'obstaculo',
        accessibility_report: {
          confidence: 'medium',
          blockers: [
            { type: 'rough_surface', severity: 'medium' },
            { type: 'ors_no_wheelchair_route', severity: 'medium' },
          ],
        },
      }),
    ];
    const without = {
      accessible: true,
      slope_warning: false,
      total_duration: '15 min',
      stages: noisyStages,
    };
    const withFusionLow = {
      ...without,
      accessibility_fusion: {
        score: 30,
        state: 'caution' as const,
        confidence: 'medium' as const,
        alone_eligible: false,
        companied_recommended_reason: 'piso baixo',
        sourcesUsed: [],
        legResults: [],
        blockerCounts: { high: 0, medium: 2, low: 0 },
      },
    };
    const a = computeAccessibilityScore(without);
    const b = computeAccessibilityScore(withFusionLow);
    expect(b).toBeLessThan(a);
  });

  it('partição: fallback quando todas as rotas ficam abaixo de 60 (não retorna listas vazias)', () => {
    const lowRoute = {
      accessible: false,
      slope_warning: true,
      total_duration: '50 min',
      stages: [
        walk({ accessible: false, slope_warning: true, duration: '50 min' }),
      ],
      accessibility_fusion: {
        score: 20,
        state: 'caution' as const,
        confidence: 'high' as const,
        alone_eligible: false,
        companied_recommended_reason: 'Trecho difícil',
        sourcesUsed: [],
        legResults: [],
        blockerCounts: { high: 1, medium: 0, low: 0 },
      },
    };
    const s = computeAccessibilityScore(lowRoute);
    expect(s).toBeLessThan(60);
    const part = partitionRoutesByScore([lowRoute]);
    expect(part.alone).toHaveLength(0);
    expect(part.companied).toHaveLength(1);
    expect(part.companied[0].accessibility_score).toBe(s);
  });

  it('partition: rotas 60–79 vão para Acompanhado', () => {
    const midScoreRoute = {
      accessible: true,
      slope_warning: false,
      total_duration: '20 min',
      stages: [walk()],
      accessibility_fusion: {
        score: 65,
        state: 'caution' as const,
        confidence: 'low' as const,
        alone_eligible: false,
        companied_recommended_reason: 'Score na faixa de acompanhado',
        sourcesUsed: [],
        legResults: [],
        blockerCounts: { high: 0, medium: 0, low: 0 },
      },
    };
    const score = computeAccessibilityScore(midScoreRoute);
    expect(score).toBeGreaterThanOrEqual(60);
    expect(score).toBeLessThanOrEqual(79);
    const part = partitionRoutesByScore([midScoreRoute]);
    expect(part.alone).toHaveLength(0);
    expect(part.companied).toHaveLength(1);
  });
});
