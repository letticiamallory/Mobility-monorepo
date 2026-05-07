import * as Location from 'expo-location';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  closestPolylineVertexIndex,
  currentStageIndexFromProgress,
  stageFirstPolylineIndices,
  summarizeStageForNotification,
  type LatLng,
} from '@/utils/route-progress';
import {
  ensureJourneyNotificationPermission,
  postJourneyStepNotification,
} from '@/services/journey-notifications';

type StageNav = { mode: string; instruction: string };
type RouteNav = { stages: { points?: LatLng[] }[] };

type Options = {
  route: RouteNav | null;
  polylineCoords: LatLng[];
  orderedStages: StageNav[];
};

export function useRouteLiveNavigation({ route, polylineCoords, orderedStages }: Options) {
  const [navActive, setNavActive] = useState(false);
  const [userLocation, setUserLocation] = useState<LatLng | null>(null);
  const [currentStageIndex, setCurrentStageIndex] = useState(0);
  const [navError, setNavError] = useState<string | null>(null);

  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const lastNotifiedStage = useRef(-1);

  const stopWatch = useCallback(() => {
    watchRef.current?.remove();
    watchRef.current = null;
  }, []);

  const stopNavigation = useCallback(() => {
    stopWatch();
    setNavActive(false);
    setNavError(null);
    lastNotifiedStage.current = -1;
  }, [stopWatch]);

  const startNavigation = useCallback(async () => {
    if (!route || polylineCoords.length < 2) {
      setNavError('Rota inválida para navegação.');
      return;
    }
    setNavError(null);
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== Location.PermissionStatus.GRANTED) {
      setNavError('Permita a localização para acompanhar o trajeto.');
      return;
    }
    await ensureJourneyNotificationPermission();
    lastNotifiedStage.current = -1;
    setCurrentStageIndex(0);
    setNavActive(true);

    const first = await Location.getCurrentPositionAsync({
      accuracy: Location.Accuracy.Balanced,
    });
    const u = {
      latitude: first.coords.latitude,
      longitude: first.coords.longitude,
    };
    setUserLocation(u);

    const stageStarts = stageFirstPolylineIndices(route);
    const idx = closestPolylineVertexIndex(u, polylineCoords);
    const stageIdx = currentStageIndexFromProgress(
      idx,
      stageStarts,
      orderedStages.length,
    );
    setCurrentStageIndex(stageIdx);
    if (stageIdx > lastNotifiedStage.current && orderedStages[stageIdx]) {
      lastNotifiedStage.current = stageIdx;
      void postJourneyStepNotification(
        'Mobility — viagem iniciada',
        summarizeStageForNotification(orderedStages[stageIdx], stageIdx + 1),
      );
    }

    stopWatch();
    watchRef.current = await Location.watchPositionAsync(
      {
        accuracy: Location.Accuracy.Balanced,
        timeInterval: 4000,
        distanceInterval: 12,
      },
      (loc) => {
        const p = { latitude: loc.coords.latitude, longitude: loc.coords.longitude };
        setUserLocation(p);
        const closest = closestPolylineVertexIndex(p, polylineCoords);
        const sIdx = currentStageIndexFromProgress(
          closest,
          stageStarts,
          orderedStages.length,
        );
        setCurrentStageIndex(sIdx);
        if (sIdx > lastNotifiedStage.current && orderedStages[sIdx]) {
          lastNotifiedStage.current = sIdx;
          void postJourneyStepNotification(
            `Etapa ${sIdx + 1} de ${orderedStages.length}`,
            summarizeStageForNotification(orderedStages[sIdx], sIdx + 1),
          );
        }
      },
    );
  }, [route, polylineCoords, orderedStages, stopWatch]);

  useEffect(() => {
    return () => {
      stopWatch();
    };
  }, [stopWatch]);

  return {
    navActive,
    userLocation,
    currentStageIndex,
    navError,
    startNavigation,
    stopNavigation,
  };
}
