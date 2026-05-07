import { WalkAccessibilityEngineService } from './walk-accessibility-engine.service';
import type { OverpassService } from '../accessibility/overpass.service';
import type { OrsService } from './ors.service';
import type { RouteStage } from './google-routes.service';

describe('WalkAccessibilityEngineService', () => {
  const overpassOk = {
    stepFeatureCount: 0,
    roughSurfaceFeatureCount: 0,
    queryFailed: false,
  };

  const baseStage: RouteStage = {
    stage: 1,
    mode: 'walk',
    instruction: '',
    distance: '100 m',
    duration: '2 min',
    location: { lat: -23.55, lng: -46.63 },
    end_location: { lat: -23.551, lng: -46.631 },
    accessible: true,
    warning: null,
    street_view_image: null,
  };

  afterEach(() => {
    delete process.env.DISABLE_STRUCTURAL_ACCESSIBILITY;
    delete process.env.ORS_API_KEY;
    delete process.env.ORS_DETOUR_DISABLED;
    delete process.env.ORS_DETOUR_RATIO;
    delete process.env.ORS_DETOUR_MIN_EXTRA_M;
  });

  it('sem geometria completa → missing_geometry', async () => {
    const overpass = {
      getWalkSegmentStepBarriers: jest.fn(),
    } as unknown as OverpassService;
    const ors = { calculateRoute: jest.fn() } as unknown as OrsService;
    const engine = new WalkAccessibilityEngineService(overpass, ors);
    const stage = {
      ...baseStage,
      end_location: { lat: NaN, lng: -46.631 },
    };
    const report = await engine.analyzeWalkLeg({ stage, slopePercent: null });
    expect(report.blockers.some((b) => b.type === 'missing_geometry')).toBe(true);
    expect(overpass.getWalkSegmentStepBarriers).not.toHaveBeenCalled();
  });

  it('com Overpass sem degraus e inclinação baixa → high confidence', async () => {
    const overpass = {
      getWalkSegmentStepBarriers: jest.fn().mockResolvedValue(overpassOk),
    } as unknown as OverpassService;
    const ors = { calculateRoute: jest.fn() } as unknown as OrsService;
    const engine = new WalkAccessibilityEngineService(overpass, ors);
    const report = await engine.analyzeWalkLeg({
      stage: baseStage,
      slopePercent: 3,
    });
    expect(report.blockers).toHaveLength(0);
    expect(report.confidence).toBe('high');
    expect(report.sources).toContain('elevation_slope');
    expect(report.sources).toContain('overpass_steps');
  });

  it('degraus no OSM → blocker stairs_or_steps', async () => {
    const overpass = {
      getWalkSegmentStepBarriers: jest.fn().mockResolvedValue({
        stepFeatureCount: 2,
        roughSurfaceFeatureCount: 0,
        queryFailed: false,
      }),
    } as unknown as OverpassService;
    const ors = { calculateRoute: jest.fn() } as unknown as OrsService;
    const engine = new WalkAccessibilityEngineService(overpass, ors);
    const report = await engine.analyzeWalkLeg({
      stage: baseStage,
      slopePercent: 2,
    });
    expect(report.blockers.some((b) => b.type === 'stairs_or_steps')).toBe(true);
  });

  it('applyHighBlockersToStage marca inacessível com escadas', async () => {
    const overpass = {
      getWalkSegmentStepBarriers: jest.fn().mockResolvedValue({
        stepFeatureCount: 1,
        roughSurfaceFeatureCount: 0,
        queryFailed: false,
      }),
    } as unknown as OverpassService;
    const ors = { calculateRoute: jest.fn() } as unknown as OrsService;
    const engine = new WalkAccessibilityEngineService(overpass, ors);
    const stage = { ...baseStage };
    const report = await engine.analyzeWalkLeg({ stage, slopePercent: 1 });
    engine.applyHighBlockersToStage(stage, report);
    expect(stage.accessible).toBe(false);
    expect(stage.warning).toContain('OpenStreetMap');
  });

  it('com ORS_API_KEY e ORS sem rota → ors_no_wheelchair_route', async () => {
    process.env.ORS_API_KEY = 'test-key';
    const overpass = {
      getWalkSegmentStepBarriers: jest.fn().mockResolvedValue(overpassOk),
    } as unknown as OverpassService;
    const ors = {
      calculateRoute: jest.fn().mockResolvedValue(null),
    } as unknown as OrsService;
    const engine = new WalkAccessibilityEngineService(overpass, ors);
    const report = await engine.analyzeWalkLeg({
      stage: baseStage,
      slopePercent: 2,
    });
    expect(report.blockers.some((b) => b.type === 'ors_no_wheelchair_route')).toBe(
      true,
    );
    expect(report.confidence).toBe('low');
  });

  it('com ORS_API_KEY e ORS falha (rede/API) → ors_error, sem blocker ORS', async () => {
    process.env.ORS_API_KEY = 'test-key';
    const overpass = {
      getWalkSegmentStepBarriers: jest.fn().mockResolvedValue(overpassOk),
    } as unknown as OverpassService;
    const ors = {
      calculateRoute: jest.fn().mockRejectedValue(new Error('timeout')),
    } as unknown as OrsService;
    const engine = new WalkAccessibilityEngineService(overpass, ors);
    const report = await engine.analyzeWalkLeg({
      stage: baseStage,
      slopePercent: 2,
    });
    expect(report.sources).toContain('ors_error');
    expect(
      report.blockers.some((b) => b.type === 'ors_no_wheelchair_route'),
    ).toBe(false);
  });

  it('superfície irregular no OSM → rough_surface (médio)', async () => {
    const overpass = {
      getWalkSegmentStepBarriers: jest.fn().mockResolvedValue({
        stepFeatureCount: 0,
        roughSurfaceFeatureCount: 1,
        queryFailed: false,
      }),
    } as unknown as OverpassService;
    const ors = { calculateRoute: jest.fn() } as unknown as OrsService;
    const engine = new WalkAccessibilityEngineService(overpass, ors);
    const report = await engine.analyzeWalkLeg({
      stage: baseStage,
      slopePercent: 2,
    });
    expect(report.blockers.some((b) => b.type === 'rough_surface')).toBe(true);
    expect(report.sources).toContain('overpass_rough_surface');
  });

  it('ORS wheelchair muito mais longo que distância declarada → ors_wheelchair_detour (baixo)', async () => {
    process.env.ORS_API_KEY = 'k';
    const overpass = {
      getWalkSegmentStepBarriers: jest.fn().mockResolvedValue(overpassOk),
    } as unknown as OverpassService;
    const ors = {
      calculateRoute: jest.fn().mockResolvedValue({
        distance_km: '0.30',
        distance_meters: 300,
        duration_minutes: 4,
        instructions: [],
        coordinates: [],
      }),
    } as unknown as OrsService;
    const engine = new WalkAccessibilityEngineService(overpass, ors);
    const report = await engine.analyzeWalkLeg({
      stage: baseStage,
      slopePercent: 1,
      declaredWalkMeters: 100,
    });
    expect(report.blockers.some((b) => b.type === 'ors_wheelchair_detour')).toBe(
      true,
    );
    expect(
      report.blockers.find((b) => b.type === 'ors_wheelchair_detour')?.severity,
    ).toBe('low');
  });

  it('ORS_DETOUR_DISABLED=1 não adiciona desvio', async () => {
    process.env.ORS_API_KEY = 'k';
    process.env.ORS_DETOUR_DISABLED = '1';
    const overpass = {
      getWalkSegmentStepBarriers: jest.fn().mockResolvedValue(overpassOk),
    } as unknown as OverpassService;
    const ors = {
      calculateRoute: jest.fn().mockResolvedValue({
        distance_km: '0.30',
        distance_meters: 300,
        duration_minutes: 4,
        instructions: [],
        coordinates: [],
      }),
    } as unknown as OrsService;
    const engine = new WalkAccessibilityEngineService(overpass, ors);
    const report = await engine.analyzeWalkLeg({
      stage: baseStage,
      slopePercent: 1,
      declaredWalkMeters: 100,
    });
    expect(report.blockers.some((b) => b.type === 'ors_wheelchair_detour')).toBe(
      false,
    );
  });

  it('applyStructuralFollowUps adiciona aviso quando ORS sem rota', async () => {
    process.env.ORS_API_KEY = 'k';
    const overpass = {
      getWalkSegmentStepBarriers: jest.fn().mockResolvedValue(overpassOk),
    } as unknown as OverpassService;
    const ors = {
      calculateRoute: jest.fn().mockResolvedValue(null),
    } as unknown as OrsService;
    const engine = new WalkAccessibilityEngineService(overpass, ors);
    const stage = { ...baseStage };
    const report = await engine.analyzeWalkLeg({ stage, slopePercent: 1 });
    engine.applyStructuralFollowUps(stage, report);
    expect(stage.warning).toContain('OpenRouteService');
  });

  it('DISABLE_STRUCTURAL_ACCESSIBILITY=1 retorna vazio', async () => {
    process.env.DISABLE_STRUCTURAL_ACCESSIBILITY = '1';
    const overpass = {
      getWalkSegmentStepBarriers: jest.fn(),
    } as unknown as OverpassService;
    const ors = { calculateRoute: jest.fn() } as unknown as OrsService;
    const engine = new WalkAccessibilityEngineService(overpass, ors);
    const report = await engine.analyzeWalkLeg({
      stage: baseStage,
      slopePercent: 12,
    });
    expect(report.blockers).toHaveLength(0);
    expect(report.sources).toContain('structural_disabled');
    expect(overpass.getWalkSegmentStepBarriers).not.toHaveBeenCalled();
  });
});
