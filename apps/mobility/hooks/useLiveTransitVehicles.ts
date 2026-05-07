import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { regionsWithActiveFeedAt } from '@/constants/br-transit-realtime';
import {
  fetchVehiclesFromFeeds,
  filterVehiclesNearPolyline,
  type LiveVehicle,
} from '@/services/gtfs-vehicle-positions';
import type { LatLng } from '@/utils/route-progress';

const POLL_MS = 18000;
const NEAR_POLYLINE_M = 480;
const MAX_MARKERS = 90;

type Params = {
  mapCenter: LatLng;
  transitPolyline: LatLng[];
  enabled: boolean;
};

export function useLiveTransitVehicles({ mapCenter, transitPolyline, enabled }: Params) {
  const [vehicles, setVehicles] = useState<LiveVehicle[]>([]);
  const [loading, setLoading] = useState(false);
  const [lastError, setLastError] = useState<string | null>(null);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const regions = useMemo(
    () => regionsWithActiveFeedAt(mapCenter.latitude, mapCenter.longitude),
    [mapCenter.latitude, mapCenter.longitude],
  );
  const urls = useMemo(
    () => regions.map((r) => r.vehiclePositionsUrl).filter((u): u is string => u != null),
    [regions],
  );
  const coverageHint =
    regions.length === 0
      ? 'Esta região ainda não tem feed GTFS-RT configurado no app (ex.: Montes Claros depende de dados públicos da MCTrans).'
      : urls.length === 0
        ? `${regions.map((r) => r.name).join(', ')}: sem URL de veículos em tempo real no momento.`
        : `Dados ao vivo: ${regions
            .filter((r) => r.vehiclePositionsUrl)
            .map((r) => r.name)
            .join(', ')}`;

  const refresh = useCallback(async () => {
    if (!enabled || urls.length === 0 || transitPolyline.length < 2) {
      setVehicles([]);
      return;
    }
    setLoading(true);
    setLastError(null);
    try {
      const all = await fetchVehiclesFromFeeds(urls);
      const filtered = filterVehiclesNearPolyline(
        all,
        transitPolyline,
        NEAR_POLYLINE_M,
        MAX_MARKERS,
      );
      setVehicles(filtered);
    } catch {
      setLastError('Não foi possível atualizar posição dos veículos.');
      setVehicles([]);
    } finally {
      setLoading(false);
    }
  }, [enabled, urls, transitPolyline]);

  useEffect(() => {
    if (!enabled) {
      setVehicles([]);
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
      return;
    }
    void refresh();
    tickRef.current = setInterval(() => {
      void refresh();
    }, POLL_MS);
    return () => {
      if (tickRef.current) clearInterval(tickRef.current);
      tickRef.current = null;
    };
  }, [enabled, refresh]);

  return { vehicles, loading, lastError, coverageHint, refresh };
}
