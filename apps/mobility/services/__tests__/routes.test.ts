jest.mock('../../constants/api', () => ({
  API_URL: 'http://127.0.0.1:3000',
}));

jest.mock('../token.service', () => ({
  getToken: jest.fn().mockResolvedValue('mock-token'),
}));

import { getToken } from '../token.service';
import { searchRoutes } from '../routes.service';

global.fetch = jest.fn() as jest.Mock;

describe('searchRoutes', () => {
  let consoleLog: jest.SpyInstance;
  let consoleError: jest.SpyInstance;

  beforeEach(() => {
    jest.clearAllMocks();
    (getToken as jest.Mock).mockResolvedValue('mock-token');
    consoleLog = jest.spyOn(console, 'log').mockImplementation(() => {});
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleLog.mockRestore();
    consoleError.mockRestore();
  });

  it('deve enviar accompanied corretamente', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({
          route: { id: 1 },
          routes: [
            { total_duration: '10 minutos', accessible: true, stages: [] },
          ],
        }),
    });

    await searchRoutes(
      'Ibituruna',
      'Shopping',
      1,
      'bus',
      'alone',
    );

    const callBody = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(callBody.accompanied).toBe('alone');
  });

  it('deve retornar rotas quando API responde com sucesso', async () => {
    const mockRoutes = [
      { total_duration: '10 minutos', accessible: true, stages: [] },
      { total_duration: '15 minutos', accessible: false, stages: [] },
    ];

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () =>
        JSON.stringify({ route: { id: 1 }, routes: mockRoutes }),
    });

    const result = (await searchRoutes(
      'Ibituruna',
      'Shopping',
      1,
      'bus',
    )) as { routes: Array<{ accessible: boolean }> };

    expect(result.routes).toHaveLength(2);
    expect(result.routes[0].accessible).toBe(true);
  });

  it('deve lançar erro quando API falha', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 500,
      text: async () => JSON.stringify({ message: 'Erro interno' }),
    });

    await expect(
      searchRoutes('Ibituruna', 'Shopping', 1, 'bus'),
    ).rejects.toMatchObject({ message: 'Erro interno', status: 500 });
  });

  it('não inclui accompanied quando undefined ou string vazia', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ routes: [] }),
    });
    await searchRoutes('A', 'B', 1, 'bus', '');
    let body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body).not.toHaveProperty('accompanied');

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ routes: [] }),
    });
    await searchRoutes('A', 'B', 1, 'bus', undefined);
    body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body).not.toHaveProperty('accompanied');
  });

  it('inclui time_filter, time_value e route_preference quando definidos', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ routes: [] }),
    });
    await searchRoutes('A', 'B', 1, 'subway', 'companied', 'set_arrival_time', '18:00', 'less_transfers');
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body).toMatchObject({
      time_filter: 'set_arrival_time',
      time_value: '18:00',
      route_preference: 'less_transfers',
      accompanied: 'companied',
    });
  });

  it('prefere route_preferences no corpo e omite route_preference legado', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ routes: [] }),
    });
    await searchRoutes('A', 'B', 1, 'bus', undefined, 'leave_now', undefined, 'less_transfers', {
      routePreferences: ['less_transfers', 'less_walking'],
    });
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.route_preferences).toEqual(['less_transfers', 'less_walking']);
    expect(body).not.toHaveProperty('route_preference');
  });

  it('omite time_filter quando vazio', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ routes: [] }),
    });
    await searchRoutes('A', 'B', 1, 'bus', 'alone', '', '08:00');
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body).not.toHaveProperty('time_filter');
  });

  it('corpo JSON inválido não quebra — parse falha e result null até ok check', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => 'not json {{{',
    });
    const r = await searchRoutes('A', 'B', 1, 'walk');
    expect(r).toBeNull();
  });

  it('401 mantém status no erro', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: false,
      status: 401,
      text: async () => '',
    });
    await expect(searchRoutes('A', 'B', 1, 'bus')).rejects.toMatchObject({ status: 401 });
  });

  it('token null ainda envia Authorization (string vazia)', async () => {
    (getToken as jest.Mock).mockResolvedValueOnce(null);
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ routes: [] }),
    });
    await searchRoutes('A', 'B', 1, 'bus');
    const headers = (global.fetch as jest.Mock).mock.calls[0][1].headers;
    expect(headers.Authorization).toBe('Bearer ');
  });

  it('substitui placeholder "Local atual" por lat,lng quando há coordenadas', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      text: async () => JSON.stringify({ routes: [] }),
    });
    await searchRoutes('Local atual', 'Shopping Centro', 1, 'bus', undefined, undefined, undefined, undefined, {
      originCoord: { latitude: -16.7, longitude: -43.86 },
    });
    const body = JSON.parse((global.fetch as jest.Mock).mock.calls[0][1].body);
    expect(body.origin).toBe('-16.7,-43.86');
    expect(body.destination).toBe('Shopping Centro');
    expect(body.origin_latitude).toBe(-16.7);
    expect(body.origin_longitude).toBe(-43.86);
  });
});
