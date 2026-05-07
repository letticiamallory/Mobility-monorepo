import { Injectable, Logger } from '@nestjs/common';

interface NominatimResult {
  lat: string;
  lon: string;
}

@Injectable()
export class NominatimService {
  private readonly logger = new Logger(NominatimService.name);

  /** ~39 km de meia-largura: prioriza resultados na região sem excluir o resto (bounded=0). */
  private static readonly VIEWBOX_DELTA_DEG = 0.35;

  private haversineMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  private pickClosestTo(
    results: NominatimResult[],
    near: { lat: number; lon: number },
  ): NominatimResult {
    let best = results[0];
    let bestD = Number.POSITIVE_INFINITY;
    for (const r of results) {
      const lat = parseFloat(r.lat);
      const lon = parseFloat(r.lon);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
      const d = this.haversineMeters(near.lat, near.lon, lat, lon);
      if (d < bestD) {
        bestD = d;
        best = r;
      }
    }
    return best;
  }

  /**
   * Resolve texto de endereço via Nominatim.
   * Com `near`, pede vários candidatos, usa viewbox regional e escolhe o mais próximo de `near`
   * (ex.: destino perto da origem já geocodificada).
   */
  /**
   * Aceita strings `lat,lon` / `lat, lon` (mesmo formato do Google Directions).
   * Evita depender do `/search` do Nominatim para coordenadas puras (costuma ser instável).
   */
  private parseLatLonLiteral(address: string): { lat: number; lon: number } | null {
    const t = address.trim();
    const m = /^(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)$/.exec(t);
    if (!m) return null;
    const lat = parseFloat(m[1]);
    const lon = parseFloat(m[2]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon };
  }

  async getCoordinates(
    address: string,
    near?: { lat: number; lon: number },
  ): Promise<{ lat: number; lon: number } | null> {
    try {
      const literal = this.parseLatLonLiteral(address);
      if (literal) return literal;

      const limit = near ? 8 : 1;
      let url =
        `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}` +
        `&format=json&limit=${limit}&addressdetails=0`;
      if (near) {
        const d = NominatimService.VIEWBOX_DELTA_DEG;
        const minLon = near.lon - d;
        const maxLon = near.lon + d;
        const minLat = near.lat - d;
        const maxLat = near.lat + d;
        url += `&viewbox=${minLon},${maxLat},${maxLon},${minLat}&bounded=0`;
      }
      const response = await fetch(url, {
        headers: { 'User-Agent': 'MobilityAPI/1.0' },
      });

      if (!response.ok) {
        throw new Error(`Nominatim API error: ${response.status}`);
      }

      const data = (await response.json()) as NominatimResult[];

      if (data.length === 0) {
        return null;
      }

      const chosen =
        near && data.length > 1 ? this.pickClosestTo(data, near) : data[0];

      return {
        lat: parseFloat(chosen.lat),
        lon: parseFloat(chosen.lon),
      };
    } catch (error) {
      this.logger.error(
        `Erro no NominatimService: ${(error as Error).message}`,
      );
      return null;
    }
  }
}
