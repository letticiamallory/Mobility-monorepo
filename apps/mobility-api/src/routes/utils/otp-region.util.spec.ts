import {
  BRASILIA_DF_BBOX,
  MONTES_CLAROS_BBOX,
  detectOtpRegionForRoute,
  pointInBbox,
} from './otp-region.util';

describe('otp-region.util', () => {
  it('pontos no centro de Montes Claros estão na bbox', () => {
    expect(pointInBbox(-16.728, -43.858, MONTES_CLAROS_BBOX)).toBe(true);
  });

  it('pontos em Brasília estão na bbox DF', () => {
    expect(pointInBbox(-15.794, -47.883, BRASILIA_DF_BBOX)).toBe(true);
  });

  it('rota MC→MC → montes_claros', () => {
    expect(
      detectOtpRegionForRoute(-16.72, -43.86, -16.73, -43.87),
    ).toBe('montes_claros');
  });

  it('rota DF→DF → brasilia', () => {
    expect(
      detectOtpRegionForRoute(-15.8, -47.88, -15.78, -47.9),
    ).toBe('brasilia');
  });

  it('origem MC e destino DF → unknown (troca de região)', () => {
    expect(
      detectOtpRegionForRoute(-16.72, -43.86, -15.8, -47.88),
    ).toBe('unknown');
  });
});
