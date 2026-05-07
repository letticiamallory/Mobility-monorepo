/**
 * Origem/destino para Directions & Nominatim: placeholders comuns do app não geocodificam.
 * Google aceita `lat,lng` como origem/destino.
 */
export function isPlaceholderLocationLabel(label: string): boolean {
  const t = label.trim().toLowerCase();
  if (!t) return true;
  return (
    t === 'local atual' ||
    t === 'minha localização' ||
    t === 'minha localizacao' ||
    t === 'current location' ||
    t === 'my location'
  );
}

export type RouteCoordInput =
  | { latitude: number; longitude: number }
  | { lat: number; lng: number }
  | null
  | undefined;

export function toLatLngPair(coord: RouteCoordInput): { latitude: number; longitude: number } | null {
  if (coord == null) return null;
  if ('latitude' in coord && 'longitude' in coord) {
    const { latitude, longitude } = coord;
    if (Number.isFinite(latitude) && Number.isFinite(longitude))
      return { latitude, longitude };
    return null;
  }
  if ('lat' in coord && 'lng' in coord) {
    const { lat, lng } = coord;
    if (Number.isFinite(lat) && Number.isFinite(lng)) return { latitude: lat, longitude: lng };
  }
  return null;
}

export function resolveRouteEndpointForApi(label: string, coord: RouteCoordInput): string {
  const c = toLatLngPair(coord);
  const trimmed = label.trim();
  if (c != null && (isPlaceholderLocationLabel(trimmed) || !trimmed)) {
    return `${c.latitude},${c.longitude}`;
  }
  return trimmed || label;
}
