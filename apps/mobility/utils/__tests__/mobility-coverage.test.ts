import {
  isInMontesClarosArea,
  isPointInMobilityCoverage,
  isRouteWithinMobilityCoverage,
} from '../mobility-coverage';

describe('mobility-coverage', () => {
  it('Montes Claros centro está coberto', () => {
    expect(isPointInMobilityCoverage(-16.72, -43.86)).toBe(true);
    expect(isInMontesClarosArea(-16.72, -43.86)).toBe(true);
  });

  it('São Paulo não conta como área só Montes Claros', () => {
    expect(isInMontesClarosArea(-23.55, -46.63)).toBe(false);
  });

  it('Brasília aproximada está coberta', () => {
    expect(isPointInMobilityCoverage(-15.78, -47.93)).toBe(true);
  });

  it('São Paulo centro está coberta', () => {
    expect(isPointInMobilityCoverage(-23.55, -46.63)).toBe(true);
  });

  it('Rio de Janeiro está fora das três regiões', () => {
    expect(isPointInMobilityCoverage(-22.91, -43.17)).toBe(false);
  });

  it('rota exige ambos os pontos na cobertura', () => {
    expect(
      isRouteWithinMobilityCoverage(
        { latitude: -16.72, longitude: -43.86 },
        { latitude: -22.91, longitude: -43.17 },
      ),
    ).toBe(false);
    expect(
      isRouteWithinMobilityCoverage(
        { latitude: -16.72, longitude: -43.86 },
        { latitude: -16.73, longitude: -43.85 },
      ),
    ).toBe(true);
  });

  it('sem coordenadas não bloqueia', () => {
    expect(isRouteWithinMobilityCoverage(null, { lat: -22.9, lng: -43.1 })).toBe(true);
  });
});
