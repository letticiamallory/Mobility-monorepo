import { GoogleRoutesService } from './google-routes.service';

describe('GoogleRoutesService — buildTransitTimeParams', () => {
  let svc: GoogleRoutesService;

  beforeEach(() => {
    svc = new GoogleRoutesService();
  });

  function buildTransitTimeParams(timeFilter?: string, timeValue?: string): string {
    return (
      svc as unknown as {
        buildTransitTimeParams(a?: string, b?: string): string;
      }
    ).buildTransitTimeParams(timeFilter, timeValue);
  }

  it('leave_now usa departure_time = epoch segundos (agora)', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_720_000_000_000);
    expect(buildTransitTimeParams('leave_now')).toBe(
      `departure_time=${Math.floor(1_720_000_000_000 / 1000)}`,
    );
    nowSpy.mockRestore();
  });

  it('leave_plus_15 adiciona 900 s ao epoch atual', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_720_000_000_000);
    const epoch = Math.floor(1_720_000_000_000 / 1000);
    expect(buildTransitTimeParams('leave_plus_15')).toBe(`departure_time=${epoch + 15 * 60}`);
    nowSpy.mockRestore();
  });

  it('set_departure_time sem valor usa now como fallback em segundos', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(2_000_000_000_000);
    const q = buildTransitTimeParams('set_departure_time', undefined);
    expect(q).toBe(`departure_time=${Math.floor(2_000_000_000_000 / 1000)}`);
    nowSpy.mockRestore();
  });

  it('set_arrival_time sem valor usa now+3600 s', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(3_000_000_000_000);
    const base = Math.floor(3_000_000_000_000 / 1000);
    expect(buildTransitTimeParams('set_arrival_time', undefined)).toBe(`arrival_time=${base + 3600}`);
    nowSpy.mockRestore();
  });

  it('filtro desconhecido reusa baseline leave_now', () => {
    const nowSpy = jest.spyOn(Date, 'now').mockReturnValue(99_000);
    expect(buildTransitTimeParams('garbage')).toBe(`departure_time=${99}`);
    nowSpy.mockRestore();
  });

  it('last_departures_today ancora em departure_time numérico', () => {
    const q = buildTransitTimeParams('last_departures_today');
    expect(q).toMatch(/^departure_time=\d+$/);
  });

  it('set_departure_time com HH:mm produz departure_time (Google espera epoch)', () => {
    const q = buildTransitTimeParams('set_departure_time', '08:30');
    expect(q).toMatch(/^departure_time=\d+$/);
    expect(Number(q.split('=')[1])).toBeGreaterThan(1_000_000_000);
  });

  it('set_arrival_time com HH:mm produz arrival_time', () => {
    const q = buildTransitTimeParams('set_arrival_time', '09:15');
    expect(q).toMatch(/^arrival_time=\d+$/);
  });
});
