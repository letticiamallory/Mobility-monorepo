import { haversineMeters, type LatLng } from '@/utils/route-progress';

export type LiveVehicle = {
  id: string;
  latitude: number;
  longitude: number;
  routeId?: string;
  tripId?: string;
  bearing?: number;
};

// eslint-disable-next-line @typescript-eslint/no-require-imports
const FeedMessage = require('gtfs-realtime-bindings').transit_realtime.FeedMessage as {
  decode: (buf: Uint8Array) => { entity?: GtfsEntity[] };
};

type GtfsEntity = {
  vehicle?: {
    vehicle?: { id?: string; label?: string };
    trip?: { routeId?: string; tripId?: string };
    position?: { latitude?: number; longitude?: number; bearing?: number };
  };
};

function decodeFeed(buffer: ArrayBuffer): { entity?: GtfsEntity[] } {
  const uint8 = new Uint8Array(buffer);
  return FeedMessage.decode(uint8);
}

export async function fetchVehiclePositionsFromUrl(url: string): Promise<LiveVehicle[]> {
  const res = await fetch(url);
  if (!res.ok) return [];
  const buf = await res.arrayBuffer();
  let feed: { entity?: GtfsEntity[] };
  try {
    feed = decodeFeed(buf);
  } catch {
    return [];
  }
  const out: LiveVehicle[] = [];
  const entities = feed.entity ?? [];
  for (let i = 0; i < entities.length; i++) {
    const ent = entities[i];
    const v = ent?.vehicle;
    if (!v?.position || typeof v.position.latitude !== 'number' || typeof v.position.longitude !== 'number') {
      continue;
    }
    const lat = v.position.latitude;
    const lng = v.position.longitude;
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    const vid = v.vehicle?.id ?? v.vehicle?.label ?? `v-${i}`;
    const routeId = v.trip?.routeId != null ? String(v.trip.routeId) : undefined;
    const tripId = v.trip?.tripId != null ? String(v.trip.tripId) : undefined;
    const bearing =
      typeof v.position.bearing === 'number' && Number.isFinite(v.position.bearing)
        ? v.position.bearing
        : undefined;
    out.push({
      id: String(vid),
      latitude: lat,
      longitude: lng,
      routeId,
      tripId,
      bearing,
    });
  }
  return out;
}

/** Junta veículos de vários feeds (falhas ignoradas). */
export async function fetchVehiclesFromFeeds(urls: string[]): Promise<LiveVehicle[]> {
  const uniq = [...new Set(urls.filter(Boolean))];
  const batches = await Promise.all(
    uniq.map((u) =>
      fetchVehiclePositionsFromUrl(u).catch(() => [] as LiveVehicle[]),
    ),
  );
  return batches.flat();
}

/** Mantém veículos a até `maxMeters` de algum ponto da polyline (ex.: trecho de ônibus). */
export function filterVehiclesNearPolyline(
  vehicles: LiveVehicle[],
  polyline: LatLng[],
  maxMeters: number,
  maxMarkers: number,
): LiveVehicle[] {
  if (polyline.length === 0 || vehicles.length === 0) return [];
  const scored: { v: LiveVehicle; d: number }[] = [];
  for (const v of vehicles) {
    const p = { latitude: v.latitude, longitude: v.longitude };
    let dmin = Infinity;
    for (const q of polyline) {
      const d = haversineMeters(p, q);
      if (d < dmin) dmin = d;
    }
    if (dmin <= maxMeters) scored.push({ v, d: dmin });
  }
  scored.sort((a, b) => a.d - b.d);
  return scored.slice(0, maxMarkers).map((s) => s.v);
}
