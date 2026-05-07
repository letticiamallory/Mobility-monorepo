jest.mock('../../constants/api', () => ({
  API_URL: 'http://127.0.0.1:3000',
}));

import {
  fetchUserRouteHistory,
  sortRouteHistoryNewestFirst,
  type RouteHistoryApiRow,
} from '../routes.service';

global.fetch = jest.fn() as jest.Mock;

describe('fetchUserRouteHistory (pessimista)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('401/500 → [] sem lançar', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({ ok: false, status: 401 });
    await expect(fetchUserRouteHistory('t', 1)).resolves.toEqual([]);
  });

  it('JSON não-array → []', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => ({ rows: [] }),
    });
    await expect(fetchUserRouteHistory('t', 2)).resolves.toEqual([]);
  });

  it('array vazio preservado', async () => {
    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      json: async () => [],
    });
    await expect(fetchUserRouteHistory('t', 3)).resolves.toEqual([]);
  });
});

describe('sortRouteHistoryNewestFirst', () => {
  it('ordena por data desc e desempata por id', () => {
    const rows: RouteHistoryApiRow[] = [
      { id: 1, created_at: '2026-01-01T10:00:00Z' },
      { id: 3, created_at: '2026-01-02T10:00:00Z' },
      { id: 2, created_at: '2026-01-02T10:00:00Z' },
    ];
    const out = sortRouteHistoryNewestFirst(rows);
    expect(out.map((r) => r.id)).toEqual([3, 2, 1]);
  });

  it('sem created_at equivale a 0 — perde para datas válidas', () => {
    const rows: RouteHistoryApiRow[] = [
      { id: 1, created_at: '2026-01-02T10:00:00Z' },
      { id: 2 },
    ];
    const out = sortRouteHistoryNewestFirst(rows);
    expect(out[0].id).toBe(1);
  });
});
