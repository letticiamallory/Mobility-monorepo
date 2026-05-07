import { RouteAccessibilityFusionService } from './route-accessibility-fusion.service';
import type { WalkLegSignals } from './contracts/route-accessibility-fusion.contract';
import { ROUTES_ALONE_MIN_SCORE } from './utils/route-scoring.util';

const baseSignals = (overrides: Partial<WalkLegSignals> = {}): WalkLegSignals => ({
  walkCoordsOk: true,
  slopePercent: 2,
  declaredWalkMeters: 100,
  overpass: { ok: true, stepFeatureCount: 0, roughSurfaceFeatureCount: 0 },
  ors: undefined,
  gemini: undefined,
  otpWheelchair: undefined,
  ...overrides,
});

describe('RouteAccessibilityFusionService', () => {
  let svc: RouteAccessibilityFusionService;

  beforeEach(() => {
    svc = new RouteAccessibilityFusionService();
  });

  describe('signalsToEvidences', () => {
    it('marca missing_geometry quando coords inválidas', () => {
      const ev = svc.signalsToEvidences(
        baseSignals({ walkCoordsOk: false, slopePercent: null }),
      );
      expect(ev.some((e) => e.kind === 'missing_geometry' && e.severity === 'high')).toBe(
        true,
      );
    });

    it('classifica slope >8% como high e 5-8% como medium', () => {
      const high = svc.signalsToEvidences(baseSignals({ slopePercent: 12 }));
      const med = svc.signalsToEvidences(baseSignals({ slopePercent: 6.5 }));
      expect(high.some((e) => e.kind === 'excessive_slope' && e.severity === 'high')).toBe(
        true,
      );
      expect(med.some((e) => e.kind === 'moderate_slope' && e.severity === 'medium')).toBe(
        true,
      );
    });

    it('Overpass: degrau → high; superfície irregular → medium', () => {
      const ev = svc.signalsToEvidences(
        baseSignals({
          overpass: { ok: true, stepFeatureCount: 1, roughSurfaceFeatureCount: 1 },
        }),
      );
      expect(ev.some((e) => e.kind === 'stairs_or_steps' && e.severity === 'high')).toBe(
        true,
      );
      expect(ev.some((e) => e.kind === 'rough_surface' && e.severity === 'medium')).toBe(
        true,
      );
    });

    it('ORS sem rota → no_wheelchair_route medium', () => {
      const ev = svc.signalsToEvidences(
        baseSignals({ ors: { status: 'no_route' } }),
      );
      expect(
        ev.some((e) => e.kind === 'no_wheelchair_route' && e.severity === 'medium'),
      ).toBe(true);
    });

    it('ORS com desvio grande → wheelchair_detour low', () => {
      const ev = svc.signalsToEvidences(
        baseSignals({
          declaredWalkMeters: 100,
          ors: { status: 'ok', distanceMeters: 300, durationMinutes: 5 },
        }),
      );
      expect(
        ev.some((e) => e.kind === 'wheelchair_detour' && e.severity === 'low'),
      ).toBe(true);
    });

    it('Gemini "safe" só vira evidência positiva (não decisória sozinha)', () => {
      const ev = svc.signalsToEvidences(
        baseSignals({ gemini: { state: 'safe', confidence: 'medium' } }),
      );
      const positive = ev.find((e) => e.kind === 'image_clear');
      expect(positive).toBeDefined();
      expect(positive?.metadata?.positive).toBe(true);
    });

    it('Gemini falha (unknown) gera evidência low confidence (não "safe")', () => {
      const ev = svc.signalsToEvidences(
        baseSignals({ gemini: { state: 'unknown', reason: 'no_image' } }),
      );
      expect(
        ev.some((e) => e.kind === 'image_uncertain' && e.confidence === 'low'),
      ).toBe(true);
    });
  });

  describe('fuseWalkLeg — estado e score', () => {
    it('só fontes vazias → state unknown e confiança baixa', () => {
      const result = svc.fuseWalkLeg(
        baseSignals({
          walkCoordsOk: true,
          slopePercent: null,
          overpass: { ok: false, reason: 'timeout' },
        }),
      );
      expect(result.state).toBe('unknown');
      expect(result.confidence).toBe('low');
      expect(result.warning).toBeNull();
      expect(result.score).toBeLessThan(100);
    });

    it('escadas OSM (high) + Gemini ok → state unsafe (worst-wins)', () => {
      const result = svc.fuseWalkLeg(
        baseSignals({
          overpass: { ok: true, stepFeatureCount: 1, roughSurfaceFeatureCount: 0 },
          gemini: { state: 'safe', confidence: 'high' },
        }),
      );
      expect(result.state).toBe('unsafe');
      expect(result.warning).not.toBeNull();
      expect(result.alerts.some((a) => a.includes('escadas'))).toBe(true);
    });

    it('inclinação >8% confirmada por elevação → unsafe + warning textual', () => {
      const result = svc.fuseWalkLeg(baseSignals({ slopePercent: 11 }));
      expect(result.state).toBe('unsafe');
      expect(result.warning).toMatch(/inclina/i);
    });

    it('rough surface medium + ORS ausente → caution (não unsafe)', () => {
      const result = svc.fuseWalkLeg(
        baseSignals({
          overpass: { ok: true, stepFeatureCount: 0, roughSurfaceFeatureCount: 2 },
        }),
      );
      expect(result.state).toBe('caution');
      expect(result.warning).not.toBeNull();
    });

    it('trecho limpo com elevação e Overpass ok → safe e score alto', () => {
      const result = svc.fuseWalkLeg(
        baseSignals({
          slopePercent: 2,
          overpass: { ok: true, stepFeatureCount: 0, roughSurfaceFeatureCount: 0 },
        }),
      );
      expect(result.state).toBe('safe');
      expect(result.score).toBeGreaterThanOrEqual(95);
    });

    it('Gemini sozinho dizendo "unsafe" baixa estado para caution (não unsafe)', () => {
      const result = svc.fuseWalkLeg(
        baseSignals({
          gemini: { state: 'unsafe', confidence: 'medium' },
        }),
      );
      expect(['caution', 'unsafe']).toContain(result.state);
      // Gemini medium é severity medium → caution; nunca veta sozinho como unsafe high.
      expect(result.state).toBe('caution');
    });

    it('warning vem da fusão mesmo SEM Gemini (ORS sem rota)', () => {
      const result = svc.fuseWalkLeg(
        baseSignals({
          ors: { status: 'no_route' },
          gemini: undefined,
        }),
      );
      expect(result.state).toBe('caution');
      expect(result.warning).toMatch(/cadeira|OpenRoute/i);
    });
  });

  describe('fuseRoute — agregação por rota', () => {
    it('rota com todos legs safe → score alto e alone_eligible true', () => {
      const legs = [
        svc.fuseWalkLeg(baseSignals()),
        svc.fuseWalkLeg(baseSignals({ slopePercent: 1 })),
      ];
      const route = svc.fuseRoute(legs);
      expect(route.score).toBeGreaterThanOrEqual(ROUTES_ALONE_MIN_SCORE);
      expect(route.alone_eligible).toBe(true);
      expect(route.state).toBe('safe');
    });

    it('rota com leg unsafe (high confirmado) NÃO é alone_eligible', () => {
      const legs = [
        svc.fuseWalkLeg(
          baseSignals({
            overpass: { ok: true, stepFeatureCount: 2, roughSurfaceFeatureCount: 0 },
          }),
        ),
      ];
      const route = svc.fuseRoute(legs);
      expect(route.alone_eligible).toBe(false);
      expect(route.companied_recommended_reason).toMatch(/obstáculo/i);
    });

    it('todos os legs unknown → score < piso, alone_eligible false', () => {
      const legs = [
        svc.fuseWalkLeg(
          baseSignals({
            slopePercent: null,
            overpass: { ok: false, reason: 'timeout' },
          }),
        ),
        svc.fuseWalkLeg(
          baseSignals({
            slopePercent: null,
            overpass: { ok: false, reason: 'error' },
          }),
        ),
      ];
      const route = svc.fuseRoute(legs);
      expect(route.alone_eligible).toBe(false);
    });

    it('agrega sourcesUsed distintos', () => {
      const legs = [
        svc.fuseWalkLeg(
          baseSignals({
            ors: { status: 'ok', distanceMeters: 110, durationMinutes: 2 },
          }),
        ),
        svc.fuseWalkLeg(
          baseSignals({
            gemini: { state: 'safe', confidence: 'high' },
          }),
        ),
      ];
      const route = svc.fuseRoute(legs);
      expect(route.sourcesUsed).toEqual(
        expect.arrayContaining(['overpass', 'elevation']),
      );
    });
  });
});
