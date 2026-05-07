import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { PhotoCacheService } from '../cache/photo-cache.service';
import { StationsOsmCacheService, type OsmStationRow } from './stations-osm-cache.service';
import { MONTES_CLAROS_STATION_CARDS } from './montes-claros-station-cards';

type NearbyPlace = {
  place_id?: string;
  name?: string;
  vicinity?: string;
  geometry?: { location?: { lat?: number; lng?: number } };
  types?: string[];
  rating?: number;
};

function haversineMeters(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6371000;
  const r1 = (lat1 * Math.PI) / 180;
  const r2 = (lat2 * Math.PI) / 180;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(r1) * Math.cos(r2) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function formatDistanceM(m: number): string {
  if (m < 1000) return `${Math.round(m)}m`;
  return `${(m / 1000).toFixed(1)}km`;
}

@Injectable()
export class StationsService {
  private readonly logger = new Logger(StationsService.name);

  constructor(
    private readonly photoCacheService: PhotoCacheService,
    private readonly osmCache: StationsOsmCacheService,
  ) {}

  async getStationPhoto(
    name: string,
    lat: number,
    lng: number,
  ): Promise<string | null> {
    const key = this.photoCacheService.buildStationKey(lat, lng);

    const cached = await this.photoCacheService.get(key);
    if (cached) return cached;

    const photo = await this.fetchPlacesPhoto(name, lat, lng);

    if (photo) {
      await this.photoCacheService.set(key, photo, 'places');
    }

    return photo;
  }

  private async fetchPlacesPhoto(
    name: string,
    lat: number,
    lng: number,
  ): Promise<string | null> {
    const apiKey =
      process.env.GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_API_KEY ?? '';
    if (!apiKey || !name.trim()) return null;

    const input = `${name.trim()} Montes Claros`;
    const url = new URL(
      'https://maps.googleapis.com/maps/api/place/findplacefromtext/json',
    );
    url.searchParams.set('input', input);
    url.searchParams.set('inputtype', 'textquery');
    url.searchParams.set('fields', 'photos,place_id,geometry');
    url.searchParams.set('locationbias', `point:${lat},${lng}`);
    url.searchParams.set('key', apiKey);

    try {
      const { data } = await axios.get<{
        status?: string;
        candidates?: Array<{
          photos?: Array<{ photo_reference?: string }>;
        }>;
      }>(url.toString());
      if (data.status !== 'OK' || !data.candidates?.length) return null;
      const ref = data.candidates[0].photos?.[0]?.photo_reference;
      if (!ref) return null;

      const photoUrl = new URL(
        'https://maps.googleapis.com/maps/api/place/photo',
      );
      photoUrl.searchParams.set('maxwidth', '400');
      photoUrl.searchParams.set('photo_reference', ref);
      photoUrl.searchParams.set('key', apiKey);
      return photoUrl.toString();
    } catch {
      return null;
    }
  }

  /**
   * Paradas / terminais próximos via Places Nearby Search.
   * Agrega tipos de transporte e raio maior que o filtro único `bus_station` + 800 m,
   * que costuma voltar vazio fora de grandes centros. Não chama Place Details por
   * resultado (evita timeout e estouro de cota).
   */
  async getNearby(lat: number, lng: number) {
    // Montes Claros: usar estações pré-carregadas via OSM/Overpass (sem Google runtime).
    if (this.isInMontesClarosArea(lat, lng)) {
      const list = await this.osmCache.getMontesClarosStations();
      return this.nearbyFromPreloaded(lat, lng, list);
    }

    const apiKey =
      process.env.GOOGLE_MAPS_API_KEY ?? process.env.GOOGLE_API_KEY ?? '';
    if (!apiKey?.trim()) {
      this.logger.warn('stations/nearby: GOOGLE_API_KEY / GOOGLE_MAPS_API_KEY ausente');
      return [];
    }

    const radius = 2800;
    const types = ['bus_station', 'subway_station', 'transit_station'] as const;

    const fetchType = async (type: string): Promise<NearbyPlace[]> => {
      const nearbyUrl =
        `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
        `?location=${lat},${lng}&radius=${radius}&type=${encodeURIComponent(type)}&key=${apiKey}`;
      try {
        const { data } = await axios.get<{
          status?: string;
          results?: NearbyPlace[];
          error_message?: string;
        }>(nearbyUrl);
        if (data.status === 'REQUEST_DENIED' || data.status === 'INVALID_REQUEST') {
          this.logger.warn(
            `stations/nearby type=${type}: ${data.status} ${data.error_message ?? ''}`,
          );
          return [];
        }
        return data.results ?? [];
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        this.logger.warn(`stations/nearby type=${type}: ${msg}`);
        return [];
      }
    };

    const fetchKeyword = async (keyword: string): Promise<NearbyPlace[]> => {
      const url =
        `https://maps.googleapis.com/maps/api/place/nearbysearch/json` +
        `?location=${lat},${lng}&radius=${radius}` +
        `&keyword=${encodeURIComponent(keyword)}&key=${apiKey}`;
      try {
        const { data } = await axios.get<{
          status?: string;
          results?: NearbyPlace[];
        }>(url);
        return data.results ?? [];
      } catch {
        return [];
      }
    };

    const buckets = await Promise.all(types.map((t) => fetchType(t)));
    const byId = new Map<string, NearbyPlace>();
    for (const list of buckets) {
      for (const p of list) {
        const id = p.place_id;
        if (id && !byId.has(id)) byId.set(id, p);
      }
    }

    if (byId.size === 0) {
      const fallback = await Promise.all([
        fetchKeyword('terminal ônibus'),
        fetchKeyword('ponto de ônibus'),
      ]);
      for (const list of fallback) {
        for (const p of list) {
          const id = p.place_id;
          if (id && !byId.has(id)) byId.set(id, p);
        }
      }
    }

    const merged = [...byId.values()].filter(
      (p) =>
        typeof p.geometry?.location?.lat === 'number' &&
        typeof p.geometry?.location?.lng === 'number',
    );

    merged.sort(
      (a, b) =>
        haversineMeters(
          lat,
          lng,
          a.geometry!.location!.lat!,
          a.geometry!.location!.lng!,
        ) -
        haversineMeters(
          lat,
          lng,
          b.geometry!.location!.lat!,
          b.geometry!.location!.lng!,
        ),
    );

    const top = merged.slice(0, 28);

    return top.map((place) => {
      const plat = place.geometry!.location!.lat!;
      const plng = place.geometry!.location!.lng!;
      const d = haversineMeters(lat, lng, plat, plng);
      const typesLower = (place.types ?? []).map((t) => t.toLowerCase());
      const isSubway =
        typesLower.includes('subway_station') ||
        typesLower.includes('light_rail_station');

      return {
        id: place.place_id!,
        type: isSubway ? 'subway' : 'bus',
        name: place.name ?? 'Parada',
        address: place.vicinity ?? '',
        lat: plat,
        lng: plng,
        distanceNum: Math.round(d),
        distance: formatDistanceM(d),
        /** Nearby não traz wheelchair; não marcamos como falso. */
        accessible: true,
        lines: [] as string[],
        nextBus: null as string | null,
        rating: place.rating ?? null,
      };
    });
  }

  private isInMontesClarosArea(lat: number, lng: number): boolean {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
    // BBox aproximada (mesma ideia do app) — suficiente para escolher o dataset correto.
    const south = -16.86;
    const west = -44.08;
    const north = -16.60;
    const east = -43.78;
    return lat >= south && lat <= north && lng >= west && lng <= east;
  }

  private nearbyFromPreloaded(lat: number, lng: number, list: OsmStationRow[]) {
    const withDistance = list
      .map((s) => {
        const card = MONTES_CLAROS_STATION_CARDS[s.id];
        const d = haversineMeters(lat, lng, s.lat, s.lng);
        const linesFromOsm = Array.isArray(s.lines) ? [...s.lines] : [];
        return {
          id: s.id,
          type: s.type,
          name: card?.name ?? s.name,
          address: (card?.address ?? s.address ?? '').trim(),
          lat: s.lat,
          lng: s.lng,
          distanceNum: Math.round(d),
          distance: formatDistanceM(d),
          accessible: card?.accessible ?? s.accessible !== false,
          lines: card?.lines?.length ? [...card.lines] : linesFromOsm,
          nextBus: (card?.nextBus ?? null) as string | null,
          rating: null as number | null,
        };
      })
      .sort((a, b) => a.distanceNum - b.distanceNum);

    // Mantém comportamento anterior: 28 itens.
    return withDistance.slice(0, 28);
  }
}
