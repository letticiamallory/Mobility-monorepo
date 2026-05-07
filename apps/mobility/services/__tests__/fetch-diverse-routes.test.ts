jest.mock('../../constants/api', () => ({
  API_URL: 'http://127.0.0.1:3000',
}));

jest.mock('../token.service', () => ({
  getToken: jest.fn().mockResolvedValue('mock-token'),
}));

jest.mock('../routes.service', () => ({
  searchRoutes: jest.fn(),
}));

import { searchRoutes } from '../routes.service';
import { fetchDiverseRoutes } from '../fetch-diverse-routes';

const searchRoutesMock = searchRoutes as jest.MockedFunction<typeof searchRoutes>;

describe('fetchDiverseRoutes', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('deduplica rotas com a mesma assinatura em cada aba', async () => {
    const sameRoute = {
      total_duration: '10 min',
      total_distance: '1 km',
      stages: [{ mode: 'bus', line_code: '100', stop_name: 'A' }],
    };
    searchRoutesMock.mockResolvedValue({
      route: { id: 1 },
      routes_alone: [sameRoute],
      routes_companied: [],
    });

    const out = await fetchDiverseRoutes('Origem', 'Dest', 1);
    expect(out.alone).toHaveLength(1);
    expect(out.companied).toHaveLength(0);
    expect(searchRoutesMock.mock.calls.length).toBeGreaterThanOrEqual(4);
  });

  it('faz fallback para bus quando nenhum transporte retorna rotas', async () => {
    const fallback = {
      total_duration: '5 min',
      stages: [{ mode: 'walk' }],
    };
    let n = 0;
    searchRoutesMock.mockImplementation(async () => {
      n += 1;
      if (n === 5) {
        return {
          route: { id: 1 },
          routes_alone: [],
          routes_companied: [fallback],
        };
      }
      return { route: { id: 1 }, routes_alone: [], routes_companied: [] };
    });

    const out = await fetchDiverseRoutes('O', 'D', 2);
    expect(out.companied).toEqual([fallback]);
    expect(n).toBe(5);
  });

  it('repassa time_filter, route_preferences combinados e accompanied real', async () => {
    searchRoutesMock.mockResolvedValue({
      route: { id: 1 },
      routes_alone: [],
      routes_companied: [],
    });
    await fetchDiverseRoutes('A', 'B', 3, 'alone', 'set_departure_time', '08:00', undefined, {
      routePreferences: ['less_walking', 'less_transfers'],
    });
    const first = searchRoutesMock.mock.calls[0];
    expect(first[4]).toBe('alone');
    expect(first[5]).toBe('set_departure_time');
    expect(first[6]).toBe('08:00');
    expect(first[7]).toBeUndefined();
    const opts = first[8] as { routePreferences?: string[] };
    expect(opts.routePreferences).toEqual(['less_walking', 'less_transfers']);
  });

  it('quando accompanied não é informado, encaminha undefined (cliente não força)', async () => {
    searchRoutesMock.mockResolvedValue({
      route: { id: 1 },
      routes_alone: [],
      routes_companied: [],
    });
    await fetchDiverseRoutes('A', 'B', 3);
    const first = searchRoutesMock.mock.calls[0];
    expect(first[4]).toBeUndefined();
  });

  it('ignora lotes rejeitados no Promise.allSettled sem lançar', async () => {
    searchRoutesMock.mockImplementation(async (_o, _d, _u, type: string) => {
      if (type === 'subway') {
        throw new Error('rede fora');
      }
      return {
        route: { id: 1 },
        routes_alone: [{ total_duration: '1 min', stages: [{ mode: 'bus' }] }],
        routes_companied: [],
      };
    });
    const out = await fetchDiverseRoutes('O', 'D', 1);
    expect(out.alone.length).toBeGreaterThanOrEqual(1);
  });

  it('payload legado só routes + search_profile mapeia para uma aba', async () => {
    searchRoutesMock.mockResolvedValue({ route: { id: 1 }, search_profile: 'alone', routes: [{ x: 1 }] });
    let out = await fetchDiverseRoutes('O', 'D', 1);
    expect(out.alone).toEqual([{ x: 1 }]);
    expect(out.companied).toEqual([]);
    searchRoutesMock.mockResolvedValue({ routes: null });
    out = await fetchDiverseRoutes('O', 'D', 1);
    expect(out.alone).toEqual([]);
    expect(out.companied).toEqual([]);
  });

  it('dedup mantém primeira ocorrência da assinatura por aba', async () => {
    const dup = { total_duration: '5 min', total_distance: '1 km', stages: [{ mode: 'bus', line_code: '1' }] };
    let n = 0;
    searchRoutesMock.mockImplementation(async () => {
      n += 1;
      return { routes_alone: [dup, dup], routes_companied: [] };
    });
    const out = await fetchDiverseRoutes('O', 'D', 1);
    expect(out.alone).toHaveLength(1);
    expect(n).toBeGreaterThanOrEqual(1);
  });

  it('aceita API só com routes_alone (sem exigir routes_companied)', async () => {
    searchRoutesMock.mockResolvedValue({
      route: { id: 1 },
      routes_alone: [{ total_duration: '5 min', stages: [{ mode: 'bus' }] }],
    });
    const out = await fetchDiverseRoutes('O', 'D', 1);
    expect(out.alone).toHaveLength(1);
    expect(out.companied).toEqual([]);
  });

  it('não repete na aba acompanhado assinatura já presente em sozinho', async () => {
    const r = {
      total_duration: '8 min',
      stages: [{ mode: 'bus', line_code: '10', stop_name: 'X' }],
    };
    searchRoutesMock.mockResolvedValue({
      routes_alone: [r],
      routes_companied: [r],
    });
    const out = await fetchDiverseRoutes('O', 'D', 1);
    expect(out.alone).toHaveLength(1);
    expect(out.companied).toHaveLength(0);
  });
});
