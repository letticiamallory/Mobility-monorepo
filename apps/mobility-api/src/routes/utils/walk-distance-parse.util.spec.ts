import { parseWalkDistanceToMeters } from './walk-distance-parse.util';

describe('parseWalkDistanceToMeters', () => {
  it.each([
    ['300 m', 300],
    ['300m', 300],
    ['1,2 km', 1200],
    ['1.5 km', 1500],
    ['0 m', 0],
  ])('%p → %p', (input, expected) => {
    expect(parseWalkDistanceToMeters(input)).toBe(expected);
  });

  it('retorna null para vazio ou não reconhecido', () => {
    expect(parseWalkDistanceToMeters('')).toBeNull();
    expect(parseWalkDistanceToMeters(undefined)).toBeNull();
    expect(parseWalkDistanceToMeters('5 min')).toBeNull();
  });
});
