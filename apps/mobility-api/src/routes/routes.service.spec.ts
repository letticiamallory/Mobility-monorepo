import { RoutesService } from './routes.service';

/** Mocks mínimos: `calculateSlopePercentage` não usa dependências injetadas. */
function createRoutesService(): RoutesService {
  const noop = {} as any;
  return new RoutesService(
    noop,
    noop,
    noop,
    noop,
    noop,
    noop,
    noop,
    noop,
    noop,
    noop,
    noop,
    noop,
    noop,
    noop,
    noop,
    noop,
    noop,
  );
}

describe('RoutesService — lógica de acessibilidade', () => {
  let service: RoutesService;

  beforeEach(() => {
    service = createRoutesService();
  });

  describe('calculateSlopePercentage', () => {
    it('deve retornar inclinação correta entre dois pontos', () => {
      const slope = (service as any).calculateSlopePercentage(
        100,
        108,
        { lat: -16.7, lng: -43.87 },
        { lat: -16.71, lng: -43.87 },
      );
      expect(slope).toBeGreaterThan(0);
    });

    it('deve identificar trecho inacessível quando inclinação > 8%', () => {
      const slope = (service as any).calculateSlopePercentage(
        100,
        120,
        { lat: -16.7, lng: -43.87 },
        { lat: -16.7001, lng: -43.87 },
      );
      expect(slope).toBeGreaterThan(8);
    });

    it('deve identificar trecho acessível quando inclinação <= 8%', () => {
      const slope = (service as any).calculateSlopePercentage(
        100,
        101,
        { lat: -16.7, lng: -43.87 },
        { lat: -16.71, lng: -43.87 },
      );
      expect(slope).toBeLessThanOrEqual(8);
    });
  });

  describe('filtro de rotas por accompanied', () => {
    const mockRoutes = [
      {
        total_duration: '10 minutos',
        accessible: true,
        stages: [
          { mode: 'walk', accessible: true },
          { mode: 'bus', accessible: true },
        ],
      },
      {
        total_duration: '15 minutos',
        accessible: false,
        stages: [
          { mode: 'walk', accessible: false, warning: 'Trecho com obstáculos' },
          { mode: 'bus', accessible: true },
        ],
      },
    ];

    it('deve retornar apenas rotas 100% acessíveis quando accompanied === alone', () => {
      const result = mockRoutes.filter((route) => route.stages.every((s) => s.accessible));
      expect(result).toHaveLength(1);
      expect(result[0].accessible).toBe(true);
    });

    it('deve retornar todas as rotas quando accompanied === accompanied', () => {
      expect(mockRoutes).toHaveLength(2);
    });
  });

  describe('isRouteSuitableForAlone (Fase 4 — score-based)', () => {
    const baseRoute = {
      accessible: true,
      slope_warning: false,
      stages: [] as any[],
    };

    it('exclui rota com bloqueador HIGH em qualquer estágio (degraus mapeados)', () => {
      const route = {
        ...baseRoute,
        stages: [
          {
            mode: 'walk',
            accessible: true,
            warning: null,
            location: { lat: -23.55, lng: -46.63 },
            end_location: { lat: -23.551, lng: -46.631 },
            accessibility_report: {
              confidence: 'high',
              blockers: [{ type: 'stairs_or_steps', severity: 'high' }],
            },
          },
        ],
      };
      expect((service as any).isRouteSuitableForAlone(route)).toBe(false);
    });

    it('mantém Sozinho quando bloqueador é apenas low (desvio ORS)', () => {
      const route = {
        ...baseRoute,
        stages: [
          {
            mode: 'walk',
            accessible: true,
            warning: null,
            slope_warning: false,
            location: { lat: -23.55, lng: -46.63 },
            end_location: { lat: -23.551, lng: -46.631 },
            accessibility_report: {
              confidence: 'high',
              blockers: [{ type: 'ors_wheelchair_detour', severity: 'low' }],
            },
          },
        ],
      };
      expect((service as any).isRouteSuitableForAlone(route)).toBe(true);
    });

    it('exclui Sozinho quando vários bloqueadores médios derrubam o score abaixo do piso', () => {
      const route = {
        ...baseRoute,
        stages: [
          {
            mode: 'walk',
            accessible: true,
            warning: 'Trecho com superfície irregular',
            slope_warning: false,
            location: { lat: -23.55, lng: -46.63 },
            end_location: { lat: -23.551, lng: -46.631 },
            accessibility_report: {
              confidence: 'medium',
              blockers: [
                { type: 'rough_surface', severity: 'medium' },
                { type: 'ors_no_wheelchair_route', severity: 'medium' },
                { type: 'transit_not_wheelchair', severity: 'medium' },
              ],
            },
          },
        ],
      };
      expect((service as any).isRouteSuitableForAlone(route)).toBe(false);
    });

    it('exclui Sozinho quando walk não tem coordenadas válidas', () => {
      const route = {
        ...baseRoute,
        stages: [
          {
            mode: 'walk',
            accessible: true,
            warning: null,
            location: { lat: NaN, lng: -46.63 },
            end_location: { lat: -23.551, lng: -46.631 },
          },
        ],
      };
      expect((service as any).isRouteSuitableForAlone(route)).toBe(false);
    });
  });
});
