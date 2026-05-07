import {
  isWalkStageMode,
  normalizeWalkStageMode,
  walkSegmentCoordsOk,
} from './stage-normalization.util';

describe('stage-normalization.util', () => {
  describe('isWalkStageMode', () => {
    it.each([
      ['walk', true],
      ['WALK', true],
      ['walking', true],
      ['Walking', true],
      ['foot', true],
      ['  foot  ', true],
      ['bus', false],
      ['subway', false],
      ['', false],
    ])('mode %p → %p', (mode, expected) => {
      expect(isWalkStageMode(mode)).toBe(expected);
    });
  });

  describe('normalizeWalkStageMode', () => {
    it('retorna walk para modos a pé', () => {
      expect(normalizeWalkStageMode('walking')).toBe('walk');
    });
    it('retorna null para outros modos', () => {
      expect(normalizeWalkStageMode('bus')).toBeNull();
    });
  });

  describe('walkSegmentCoordsOk', () => {
    const okCoords = {
      lat: -23.5,
      lng: -46.6,
    };

    it('é true com mode walk e coords finitas', () => {
      expect(
        walkSegmentCoordsOk({
          mode: 'walk',
          location: okCoords,
          end_location: { lat: -23.51, lng: -46.61 },
        }),
      ).toBe(true);
    });

    it('é true para walking', () => {
      expect(
        walkSegmentCoordsOk({
          mode: 'walking',
          location: okCoords,
          end_location: okCoords,
        }),
      ).toBe(true);
    });

    it('é false sem end_location', () => {
      expect(
        walkSegmentCoordsOk({
          mode: 'walk',
          location: okCoords,
          end_location: null,
        }),
      ).toBe(false);
    });

    it('é false para modo não pedestre', () => {
      expect(
        walkSegmentCoordsOk({
          mode: 'bus',
          location: okCoords,
          end_location: okCoords,
        }),
      ).toBe(false);
    });

    it('é false com NaN', () => {
      expect(
        walkSegmentCoordsOk({
          mode: 'walk',
          location: { lat: NaN, lng: 0 },
          end_location: { lat: 0, lng: 0 },
        }),
      ).toBe(false);
    });
  });
});
