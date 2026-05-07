/**
 * Converte texto de distância de perna a pé (Google/OTP) para metros.
 */
export function parseWalkDistanceToMeters(distanceText: string | undefined): number | null {
  if (distanceText == null || typeof distanceText !== 'string') return null;
  const t = distanceText.replace(/\s+/g, ' ').trim().toLowerCase();
  if (!t) return null;

  const km = t.match(/([\d.,]+)\s*km\b/);
  if (km) {
    const n = Number.parseFloat(km[1].replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n * 1000) : null;
  }

  const m = t.match(/([\d.,]+)\s*m\b/);
  if (m) {
    const n = Number.parseFloat(m[1].replace(',', '.'));
    return Number.isFinite(n) ? Math.round(n) : null;
  }

  return null;
}
