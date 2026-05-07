import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  InteractionManager,
  Modal,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE } from 'react-native-maps';
import { ScaledText as Text } from '@/components/ScaledText';
import { useAccessibilitySurfaces } from '@/contexts/accessibility-preferences';
import { A11Y_HIT_SLOP } from '@/constants/accessibility';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as Location from 'expo-location';
import { API_URL } from '../constants/api';
import { fetchDiverseRoutes } from '../services/fetch-diverse-routes';
import { getToken, getUserInfo } from '../services/token.service';
import { isRouteWithinMobilityCoverage } from '../utils/mobility-coverage';

const PRIMARY = '#0057A8';
const BG = '#F5F5F5';
const CARD = '#FFFFFF';
const BORDER = '#E5E7EB';
const TITLE = '#111827';
const LINE = '#94A3B8';

const MAP_FALLBACK = { latitude: -16.7167, longitude: -43.8647 };

/** Debounce para não disparar várias pré-buscas ao trocar texto/coords rapidamente. */
const PREFETCH_DEBOUNCE_MS = 450;

type PackagedRoutesPayload = { alone: unknown[]; companied: unknown[] };

function coordKey(c: { latitude: number; longitude: number } | null | undefined): string {
  if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) return '';
  return `${c.latitude.toFixed(5)},${c.longitude.toFixed(5)}`;
}

function routesPayloadCacheKey(
  userId: number,
  origin: string,
  destination: string,
  originCoord: { latitude: number; longitude: number } | null,
  destCoord: { latitude: number; longitude: number } | null,
): string {
  return `${userId}\u001f${origin.trim()}\u001f${destination.trim()}\u001f${coordKey(originCoord)}\u001f${coordKey(destCoord)}`;
}

async function fetchPackagedRoutes(
  origin: string,
  destination: string,
  userId: number,
  originCoord?: { latitude: number; longitude: number } | null,
  destCoord?: { latitude: number; longitude: number } | null,
): Promise<PackagedRoutesPayload> {
  try {
    const payload = await fetchDiverseRoutes(
      origin,
      destination,
      userId,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        ...(originCoord ? { originCoord } : {}),
        ...(destCoord ? { destinationCoord: destCoord } : {}),
      },
    );
    return {
      alone: payload.alone as unknown[],
      companied: payload.companied as unknown[],
    };
  } catch {
    return { alone: [], companied: [] };
  }
}

function paramOne(v: string | string[] | undefined): string {
  if (v == null) return '';
  return Array.isArray(v) ? (v[0] ?? '') : v;
}

function parseCoord(v: string | undefined): number | null {
  if (v == null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseCoordJsonString(s: string | undefined): { latitude: number; longitude: number } | null {
  if (s == null || !String(s).trim()) return null;
  try {
    const o = JSON.parse(String(s)) as { latitude?: number; longitude?: number };
    if (typeof o.latitude !== 'number' || typeof o.longitude !== 'number') return null;
    return { latitude: o.latitude, longitude: o.longitude };
  } catch {
    return null;
  }
}

async function geocodeAddress(
  address: string,
  key: string,
  bias?: { latitude: number; longitude: number } | null,
): Promise<{ latitude: number; longitude: number } | null> {
  try {
    let url =
      'https://maps.googleapis.com/maps/api/geocode/json' +
      `?address=${encodeURIComponent(address)}` +
      '&language=pt-BR' +
      '&region=br';
    if (bias) {
      const d = 0.35;
      const swLat = bias.latitude - d;
      const swLng = bias.longitude - d;
      const neLat = bias.latitude + d;
      const neLng = bias.longitude + d;
      url += `&bounds=${swLat},${swLng}|${neLat},${neLng}`;
    }
    url += `&key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    const json = (await res.json()) as {
      results?: { geometry?: { location?: { lat?: number; lng?: number } } }[];
    };
    const loc = json.results?.[0]?.geometry?.location;
    const lat = loc?.lat;
    const lng = loc?.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number') return null;
    return { latitude: lat, longitude: lng };
  } catch {
    return null;
  }
}

function formatGeocodeLabel(first: Location.LocationGeocodedAddress | null | undefined): string {
  if (!first) return 'Local atual';
  const parts = [first.street, first.district ?? first.subregion, first.city].filter(Boolean);
  const s = parts.join(', ');
  return s.trim() || 'Local atual';
}

export default function RoutePlanScreen() {
  const router = useRouter();
  const sx = useAccessibilitySurfaces();
  const params = useLocalSearchParams<{
    destination?: string | string[];
    origin?: string | string[];
    destLat?: string | string[];
    destLng?: string | string[];
    originLat?: string | string[];
    originLng?: string | string[];
    originCoordinate?: string | string[];
    destinationCoordinate?: string | string[];
  }>();

  const destinationParam = useMemo(() => paramOne(params.destination).trim(), [params.destination]);
  const originParam = useMemo(() => paramOne(params.origin).trim(), [params.origin]);
  const destLatParam = parseCoord(paramOne(params.destLat));
  const destLngParam = parseCoord(paramOne(params.destLng));
  const originLatParam = parseCoord(paramOne(params.originLat));
  const originLngParam = parseCoord(paramOne(params.originLng));

  const mapRef = useRef<MapView>(null);
  const routesCacheRef = useRef<{ key: string; data: PackagedRoutesPayload } | null>(null);
  const prefetchGenerationRef = useRef(0);
  const inflightRoutesByKeyRef = useRef<Map<string, Promise<PackagedRoutesPayload>>>(new Map());
  const [originLabel, setOriginLabel] = useState(originParam);
  const [destLabel, setDestLabel] = useState(destinationParam);
  const [originCoord, setOriginCoord] = useState<{ latitude: number; longitude: number } | null>(null);
  const [destCoord, setDestCoord] = useState<{ latitude: number; longitude: number } | null>(() =>
    destLatParam != null && destLngParam != null
      ? { latitude: destLatParam, longitude: destLngParam }
      : null,
  );
  const [loadError, setLoadError] = useState<string | null>(null);
  const [findRoutesLoading, setFindRoutesLoading] = useState(false);
  const [accessibilityPoints, setAccessibilityPoints] = useState<any[]>([]);
  const [googlePlaces, setGooglePlaces] = useState<any[]>([]);
  const [selectedPoint, setSelectedPoint] = useState<any>(null);
  const [placeDetails, setPlaceDetails] = useState<any>(null);

  /** Params da URL aplicados no mesmo render (evita buscar com GPS antigo antes do effect). */
  const originCoordResolved = useMemo((): { latitude: number; longitude: number } | null => {
    if (originLatParam != null && originLngParam != null) {
      return { latitude: originLatParam, longitude: originLngParam };
    }
    const oj = parseCoordJsonString(paramOne(params.originCoordinate));
    if (oj) return oj;
    return originCoord;
  }, [originLatParam, originLngParam, params.originCoordinate, originCoord]);

  const destCoordResolved = useMemo((): { latitude: number; longitude: number } | null => {
    if (destLatParam != null && destLngParam != null) {
      return { latitude: destLatParam, longitude: destLngParam };
    }
    const dj = parseCoordJsonString(paramOne(params.destinationCoordinate));
    if (dj) return dj;
    return destCoord;
  }, [destLatParam, destLngParam, params.destinationCoordinate, destCoord]);

  const fitBoth = useCallback(() => {
    const o = originCoordResolved;
    const d = destCoordResolved;
    const destAnchor = d ?? MAP_FALLBACK;
    if (!mapRef.current) return;
    if (o && d) {
      mapRef.current.fitToCoordinates([o, d], {
        edgePadding: { top: 56, right: 48, bottom: 48, left: 48 },
        animated: true,
      });
      return;
    }
    if (o && !d) {
      mapRef.current.fitToCoordinates([o, destAnchor], {
        edgePadding: { top: 56, right: 48, bottom: 48, left: 48 },
        animated: true,
      });
      return;
    }
    mapRef.current.animateToRegion(
      {
        latitude: destAnchor.latitude,
        longitude: destAnchor.longitude,
        latitudeDelta: 0.06,
        longitudeDelta: 0.06,
      },
      220,
    );
  }, [originCoordResolved, destCoordResolved]);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);

    if (!destinationParam.trim()) {
      setLoadError('Destino inválido.');
      return;
    }

    setDestLabel(destinationParam);
    if (originParam) setOriginLabel(originParam);

    const key = process.env.EXPO_PUBLIC_GOOGLE_API_KEY?.trim();

    void (async () => {
      if (destLatParam != null && destLngParam != null) {
        if (!cancelled) setDestCoord({ latitude: destLatParam, longitude: destLngParam });
        return;
      }
      const destFromJson = parseCoordJsonString(paramOne(params.destinationCoordinate));
      if (destFromJson) {
        if (!cancelled) setDestCoord(destFromJson);
        return;
      }
      if (!cancelled) setDestCoord(null);
      const nextDest = key ? await geocodeAddress(destinationParam, key) : null;
      if (cancelled) return;
      if (nextDest) {
        setDestCoord(nextDest);
      } else {
        setDestCoord({ latitude: MAP_FALLBACK.latitude, longitude: MAP_FALLBACK.longitude });
        if (!key) {
          setLoadError('Não foi possível localizar o destino no mapa.');
        }
      }
    })();

    void (async () => {
      if (originLatParam != null && originLngParam != null) {
        if (!cancelled) {
          setOriginCoord({ latitude: originLatParam, longitude: originLngParam });
        }
        return;
      }

      const originFromJson = parseCoordJsonString(paramOne(params.originCoordinate));
      if (originFromJson) {
        if (!cancelled) setOriginCoord(originFromJson);
        return;
      }

      const oText = originParam.trim();
      if (oText && oText !== 'Local atual') {
        const nextOrigin = key ? await geocodeAddress(oText, key) : null;
        if (cancelled) return;
        if (nextOrigin) {
          setOriginCoord(nextOrigin);
        } else {
          setOriginCoord(null);
        }
        return;
      }

      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (cancelled) return;
        if (perm.status !== 'granted') {
          if (!originParam) setOriginLabel('Local atual');
          setOriginCoord(null);
          return;
        }
        const last = await Location.getLastKnownPositionAsync({
          maxAge: 5 * 60 * 1000,
        });
        const pos =
          last ??
          (await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Low,
          }));
        if (cancelled) return;
        const o = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
        setOriginCoord(o);
        if (!originParam) {
          try {
            const rev = await Location.reverseGeocodeAsync({
              latitude: o.latitude,
              longitude: o.longitude,
            });
            if (!cancelled) setOriginLabel(formatGeocodeLabel(rev[0]));
          } catch {
            if (!cancelled) setOriginLabel('Local atual');
          }
        }
      } catch {
        if (!cancelled && !originParam) setOriginLabel('Local atual');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    destinationParam,
    destLatParam,
    destLngParam,
    originParam,
    originLatParam,
    originLngParam,
    params.destinationCoordinate,
    params.originCoordinate,
  ]);

  useEffect(() => {
    const t = setTimeout(() => fitBoth(), 120);
    return () => clearTimeout(t);
  }, [fitBoth]);

  /** Pré-busca alone + companied emBackground quando O/D estão definidos — o botão reaproveita cache ou a mesma promise. */
  useEffect(() => {
    if (!originCoordResolved || !destCoordResolved) {
      prefetchGenerationRef.current += 1;
      routesCacheRef.current = null;
      return;
    }

    const dest = destinationParam.trim() || destLabel.trim();
    const orig = originParam.trim() || originLabel.trim() || 'Local atual';
    if (!dest) {
      return;
    }

    if (!isRouteWithinMobilityCoverage(originCoordResolved, destCoordResolved)) {
      prefetchGenerationRef.current += 1;
      routesCacheRef.current = null;
      return;
    }

    prefetchGenerationRef.current += 1;
    const generation = prefetchGenerationRef.current;

    const debounceId = setTimeout(() => {
      void (async () => {
        try {
          const { userId } = await getUserInfo();
          if (typeof userId !== 'number' || Number.isNaN(userId)) return;
          if (generation !== prefetchGenerationRef.current) return;

          const key = routesPayloadCacheKey(userId, orig, dest, originCoordResolved, destCoordResolved);
          if (routesCacheRef.current?.key === key) return;

          let promise = inflightRoutesByKeyRef.current.get(key);
          if (!promise) {
            promise = fetchPackagedRoutes(orig, dest, userId, originCoordResolved, destCoordResolved).finally(() => {
              inflightRoutesByKeyRef.current.delete(key);
            });
            inflightRoutesByKeyRef.current.set(key, promise);
          }

          const data = await promise;
          if (generation !== prefetchGenerationRef.current) return;
          routesCacheRef.current = { key, data };
        } catch {
          // silencioso — rota ainda pode ser pedida no botão
        }
      })();
    }, PREFETCH_DEBOUNCE_MS);

    return () => clearTimeout(debounceId);
  }, [
    originCoordResolved,
    destCoordResolved,
    originLabel,
    destLabel,
    destinationParam,
    originParam,
  ]);

  const canSwapCoords = !!(originCoordResolved && destCoordResolved);

  const handleSwap = useCallback(() => {
    const oLabel = originLabel;
    const dLabel = destLabel;
    setOriginLabel(dLabel);
    setDestLabel(oLabel);
    if (originCoord && destCoord) {
      setOriginCoord(destCoord);
      setDestCoord(originCoord);
    }
    setTimeout(() => fitBoth(), 320);
  }, [originLabel, destLabel, originCoord, destCoord, fitBoth]);

  const goEditLocations = useCallback(
    (field: 'origin' | 'destination') => {
      const p: Record<string, string> = {
        origin: originLabel.trim() || originParam.trim() || 'Local atual',
        destination: destLabel.trim() || destinationParam.trim(),
        editField: field,
      };
      if (originCoordResolved) {
        p.originCoordinate = JSON.stringify({
          latitude: originCoordResolved.latitude,
          longitude: originCoordResolved.longitude,
        });
        p.originLat = String(originCoordResolved.latitude);
        p.originLng = String(originCoordResolved.longitude);
      }
      if (destCoordResolved) {
        p.destinationCoordinate = JSON.stringify({
          latitude: destCoordResolved.latitude,
          longitude: destCoordResolved.longitude,
        });
        p.destLat = String(destCoordResolved.latitude);
        p.destLng = String(destCoordResolved.longitude);
      }
      router.push({ pathname: '/search-destination', params: p });
    },
    [router, originLabel, destLabel, destinationParam, originParam, originCoordResolved, destCoordResolved],
  );

  const goFindRoutes = useCallback(async () => {
    const dest = destinationParam.trim() || destLabel.trim();
    const orig = originParam.trim() || originLabel.trim() || 'Local atual';
    if (!dest) return;

    if (
      originCoordResolved &&
      destCoordResolved &&
      !isRouteWithinMobilityCoverage(originCoordResolved, destCoordResolved)
    ) {
      router.push('/out-of-coverage');
      return;
    }

    setFindRoutesLoading(true);
    let packagedRoutes: PackagedRoutesPayload = { alone: [], companied: [] };

    try {
      const { userId } = await getUserInfo();
      if (typeof userId !== 'number' || Number.isNaN(userId)) {
        packagedRoutes = { alone: [], companied: [] };
      } else {
        const key = routesPayloadCacheKey(userId, orig, dest, originCoordResolved, destCoordResolved);

        let loadPromise: Promise<PackagedRoutesPayload>;
        if (routesCacheRef.current?.key === key) {
          loadPromise = Promise.resolve(routesCacheRef.current.data);
        } else {
          let promise = inflightRoutesByKeyRef.current.get(key);
          if (!promise) {
            promise = fetchPackagedRoutes(orig, dest, userId, originCoordResolved, destCoordResolved).finally(() => {
              inflightRoutesByKeyRef.current.delete(key);
            });
            inflightRoutesByKeyRef.current.set(key, promise);
          }
          loadPromise = promise.then((data) => {
            routesCacheRef.current = { key, data };
            return data;
          });
        }

        packagedRoutes = await loadPromise;
      }
    } catch (error) {
      packagedRoutes = { alone: [], companied: [] };

      const name = (error as { name?: string } | null)?.name;
      if (name === 'RoutesUnauthorizedError') {
        Alert.alert(
          'Sessão expirada',
          'Você precisa entrar de novo para buscar trajetos.',
          [{ text: 'OK', onPress: () => router.replace('/login') }],
        );
        return;
      }
      if (name === 'RoutesAllTimedOutError') {
        Alert.alert(
          'Tempo esgotado',
          'O servidor demorou demais para responder. Tente novamente em instantes.',
        );
        return;
      }
    } finally {
      setFindRoutesLoading(false);
    }

    const aloneCount = Array.isArray(packagedRoutes.alone) ? packagedRoutes.alone.length : 0;
    const companiedCount = Array.isArray(packagedRoutes.companied) ? packagedRoutes.companied.length : 0;
    const totalCount = aloneCount + companiedCount;
    if (totalCount === 0) {
      Alert.alert(
        'Nenhum trajeto encontrado',
        'Ajuste origem e destino. Se persistir: confirme login, conexão com a API (EXPO_PUBLIC_API_URL no app) e no servidor as variáveis OTP_URL / GOOGLE_API_KEY.',
      );
      return;
    }

    const p: Record<string, string> = {
      origin: orig,
      destination: dest,
      routes: encodeURIComponent(JSON.stringify(packagedRoutes)),
    };
    if (originCoordResolved) {
      p.originCoordinate = JSON.stringify({
        latitude: originCoordResolved.latitude,
        longitude: originCoordResolved.longitude,
      });
    }
    if (destCoordResolved) {
      p.destinationCoordinate = JSON.stringify({
        latitude: destCoordResolved.latitude,
        longitude: destCoordResolved.longitude,
      });
    }
    router.push({ pathname: '/route-results', params: p });
  }, [router, originLabel, destLabel, destinationParam, originParam, originCoordResolved, destCoordResolved]);

  const lineCoords =
    originCoordResolved && destCoordResolved
      ? [
          { latitude: originCoordResolved.latitude, longitude: originCoordResolved.longitude },
          { latitude: destCoordResolved.latitude, longitude: destCoordResolved.longitude },
        ]
      : [];
  const route = useMemo(() => {
    if (!originCoordResolved || !destCoordResolved) return null;
    return {
      stages: [
        {
          points: [
            {
              latitude: (originCoordResolved.latitude + destCoordResolved.latitude) / 2,
              longitude: (originCoordResolved.longitude + destCoordResolved.longitude) / 2,
            },
          ],
        },
      ],
    };
  }, [originCoordResolved, destCoordResolved]);

  useEffect(() => {
    if (!route) return;
    const mid = route.stages?.[Math.floor((route.stages?.length ?? 0) / 2)];
    const coord = mid?.points?.[0];
    if (!coord) return;

    const task = InteractionManager.runAfterInteractions(() => {
      void (async () => {
        const token = await getToken();
        fetch(`${API_URL}/accessibility/nearby?lat=${coord.latitude}&lng=${coord.longitude}`, {
          headers: { Authorization: `Bearer ${token ?? ''}` },
        })
          .then((r) => r.json())
          .then((data) => {
            const list = Array.isArray(data)
              ? data
              : Array.isArray((data as { data?: unknown })?.data)
                ? (data as { data: unknown[] }).data
                : [];
            setAccessibilityPoints(list);
          })
          .catch(() => {});

        const googleUrl = `https://maps.googleapis.com/maps/api/place/nearbysearch/json?location=${coord.latitude},${coord.longitude}&radius=500&keyword=acessivel+rampa+cadeirante&key=${process.env.EXPO_PUBLIC_GOOGLE_API_KEY}`;
        fetch(googleUrl)
          .then((r) => r.json())
          .then((data) => {
            const rawResults = Array.isArray((data as { results?: unknown })?.results)
              ? (data as { results: unknown[] }).results
              : [];
            const places = rawResults
              .filter((p: any) => p.wheelchair_accessible_entrance === true || p.rating >= 4)
              .map((p: any) => ({
                id: p.place_id,
                name: p.name,
                lat: p.geometry.location.lat,
                lng: p.geometry.location.lng,
                rating: p.rating,
                source: 'google',
                wheelchair: p.wheelchair_accessible_entrance ? 'yes' : 'unknown',
              }));
            setGooglePlaces(places);
          })
          .catch(() => {});
      })();
    });

    return () => task.cancel();
  }, [route]);

  const handleSelectPoint = async (point: any) => {
    setSelectedPoint(point);
    setPlaceDetails(null);

    try {
      if (point.id) {
        const detailsUrl = `https://maps.googleapis.com/maps/api/place/details/json?place_id=${point.id}&fields=name,wheelchair_accessible_entrance,photos&language=pt-BR&key=${process.env.EXPO_PUBLIC_GOOGLE_API_KEY}`;
        const detailsRes = await fetch(detailsUrl);
        const detailsData = await detailsRes.json();
        setPlaceDetails(detailsData.result ?? null);
      }
    } catch {
      // silencioso
    }
  };

  const originDisplay = originLabel.trim() || 'Local atual';
  const destDisplay = destLabel.trim() || destinationParam;
  const hasDestination = destinationParam.trim().length > 0;
  const mapRegionCenter = destCoordResolved ?? MAP_FALLBACK;

  return (
    <SafeAreaView style={[styles.safe, sx.fillScreen]} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="dark-content" />

      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={A11Y_HIT_SLOP}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={TITLE} />
        </TouchableOpacity>
      </View>

      <View style={styles.card}>
        <View style={styles.odRow}>
          <View style={styles.leftRail}>
            <View style={styles.originDot} />
            <View style={styles.railLine} />
            <MaterialCommunityIcons name="map-marker" size={22} color={PRIMARY} />
          </View>
          <View style={styles.odTexts}>
            <TouchableOpacity
              onPress={() => goEditLocations('origin')}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={`Origem: ${originDisplay}. Toque para alterar a origem`}
            >
              <Text style={styles.odPrimary} numberOfLines={1} ellipsizeMode="tail">
                {originDisplay}
              </Text>
            </TouchableOpacity>
            <View style={styles.odDivider} />
            <TouchableOpacity
              onPress={() => goEditLocations('destination')}
              activeOpacity={0.75}
              accessibilityRole="button"
              accessibilityLabel={`Destino: ${destDisplay}. Toque para alterar o destino`}
            >
              <Text style={styles.odPrimary} numberOfLines={1} ellipsizeMode="tail">
                {destDisplay}
              </Text>
            </TouchableOpacity>
          </View>
          <View style={styles.rightActions}>
            <TouchableOpacity
              style={[styles.swapCircle, !canSwapCoords && styles.swapDisabled]}
              onPress={canSwapCoords ? handleSwap : undefined}
              disabled={!canSwapCoords}
              hitSlop={A11Y_HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel="Trocar origem e destino"
              accessibilityState={{ disabled: !canSwapCoords }}
            >
              <MaterialCommunityIcons name="swap-vertical" size={22} color={PRIMARY} />
            </TouchableOpacity>
          </View>
        </View>
      </View>

      <TouchableOpacity
        style={[styles.cta, findRoutesLoading && styles.ctaDisabled]}
        onPress={() => {
          void goFindRoutes();
        }}
        disabled={findRoutesLoading}
        activeOpacity={0.92}
        accessibilityRole="button"
        accessibilityLabel={findRoutesLoading ? 'Buscando rotas' : 'Encontrar rotas'}
        accessibilityState={{ disabled: findRoutesLoading }}
      >
        {findRoutesLoading ? (
          <ActivityIndicator color="#FFFFFF" size="small" />
        ) : (
          <Text style={styles.ctaText}>Encontrar rotas</Text>
        )}
      </TouchableOpacity>

      {loadError ? <Text style={styles.warn}>{loadError}</Text> : null}

      <View style={styles.mapWrap}>
        {hasDestination ? (
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
            mapType="standard"
            showsUserLocation={false}
            showsMyLocationButton={false}
            loadingEnabled={false}
            accessibilityLabel={`Mapa da rota de ${originDisplay} até ${destDisplay}`}
            initialRegion={{
              latitude: mapRegionCenter.latitude,
              longitude: mapRegionCenter.longitude,
              latitudeDelta: 0.08,
              longitudeDelta: 0.08,
            }}
            onMapReady={fitBoth}
          >
            {originCoordResolved ? (
              <Marker coordinate={originCoordResolved} anchor={{ x: 0.5, y: 0.5 }}>
                <View style={styles.originMarker} />
              </Marker>
            ) : null}
            {destCoordResolved ? (
              <Marker coordinate={destCoordResolved} anchor={{ x: 0.5, y: 1 }}>
                <MaterialCommunityIcons name="map-marker" size={36} color={PRIMARY} />
              </Marker>
            ) : null}
            {accessibilityPoints.map((point: any) => (
              <Marker
                key={`w_${point.id}`}
                coordinate={{ latitude: point.lat, longitude: point.lng }}
                onPress={() => {
                  void handleSelectPoint({ ...point, source: 'user' });
                }}
              >
                <View
                  style={{
                    width: 28, height: 28, borderRadius: 14,
                    backgroundColor: point.wheelchair === 'yes' ? '#22c55e' : point.wheelchair === 'limited' ? '#F59E0B' : '#EF4444',
                    alignItems: 'center', justifyContent: 'center',
                    borderWidth: 2, borderColor: 'white',
                  }}
                >
                  <MaterialCommunityIcons name="wheelchair-accessibility" size={14} color="white" />
                </View>
              </Marker>
            ))}
            {googlePlaces.map((point: any) => (
              <Marker
                key={`g_${point.id}`}
                coordinate={{ latitude: point.lat, longitude: point.lng }}
                onPress={() => {
                  void handleSelectPoint({ ...point, source: 'google' });
                }}
              >
                <View
                  style={{
                    width: 28, height: 28, borderRadius: 14,
                    backgroundColor: '#0057A8',
                    alignItems: 'center', justifyContent: 'center',
                    borderWidth: 2, borderColor: 'white',
                  }}
                >
                  <MaterialCommunityIcons name="google" size={14} color="white" />
                </View>
              </Marker>
            ))}
            {lineCoords.length === 2 ? (
              <Polyline coordinates={lineCoords} strokeColor={LINE} strokeWidth={4} />
            ) : null}
          </MapView>
        ) : (
          <View style={[StyleSheet.absoluteFill, styles.mapPlaceholder]} />
        )}

        <TouchableOpacity
          style={styles.recenter}
          onPress={fitBoth}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Centralizar mapa na rota"
          hitSlop={A11Y_HIT_SLOP}
        >
          <MaterialCommunityIcons name="crosshairs-gps" size={22} color={PRIMARY} />
        </TouchableOpacity>
      </View>
      <Modal
        visible={!!selectedPoint}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedPoint(null)}
      >
        <View style={{ flex: 1 }}>
          <TouchableOpacity
            style={{ flex: 1 }}
            onPress={() => setSelectedPoint(null)}
            accessibilityLabel="Fechar detalhes do local"
            accessibilityRole="button"
          />
          <View style={{
            backgroundColor: '#FFFFFF',
            borderTopLeftRadius: 24,
            borderTopRightRadius: 24,
            maxHeight: '80%',
            shadowColor: '#000',
            shadowOpacity: 0.2,
            shadowRadius: 16,
            elevation: 10,
          }}>
            <View style={{ alignItems: 'center', paddingTop: 12, paddingBottom: 8 }}>
              <View style={{ width: 36, height: 4, backgroundColor: '#E0E0E0', borderRadius: 2 }} />
            </View>
            <ScrollView showsVerticalScrollIndicator={false} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 40 }}>
              <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                <View style={{ flex: 1, marginRight: 12 }}>
                  <Text style={{ fontSize: 18, fontWeight: '700', color: '#1E1D1D' }} numberOfLines={2}>
                    {selectedPoint?.name}
                  </Text>
                  {selectedPoint?.category && (
                    <Text style={{ fontSize: 13, color: '#999999', marginTop: 3 }}>{selectedPoint.category}</Text>
                  )}
                </View>
                <TouchableOpacity
                  onPress={() => setSelectedPoint(null)}
                  style={{ width: 32, height: 32, borderRadius: 16, backgroundColor: '#F5F5F5', alignItems: 'center', justifyContent: 'center' }}
                  accessibilityRole="button"
                  accessibilityLabel="Fechar"
                  hitSlop={A11Y_HIT_SLOP}
                >
                  <MaterialCommunityIcons name="close" size={16} color="#666666" />
                </TouchableOpacity>
              </View>
              <View style={{ backgroundColor: '#F5F7FA', borderRadius: 14, padding: 14, marginBottom: 20 }}>
                <Text style={{ fontSize: 12, fontWeight: '700', color: '#666666', letterSpacing: 0.5, marginBottom: 10 }}>
                  ACESSIBILIDADE
                </Text>
                <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                  <View style={{
                    flexDirection: 'row', alignItems: 'center', gap: 6,
                    backgroundColor: selectedPoint?.wheelchair === 'yes' ? '#DCFCE7' : selectedPoint?.wheelchair === 'limited' ? '#FEF3C7' : '#FEE2E2',
                    borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
                  }}>
                    <MaterialCommunityIcons
                      name="wheelchair-accessibility"
                      size={14}
                      color={selectedPoint?.wheelchair === 'yes' ? '#16A34A' : selectedPoint?.wheelchair === 'limited' ? '#F59E0B' : '#EF4444'}
                    />
                    <Text style={{
                      fontSize: 12, fontWeight: '600',
                      color: selectedPoint?.wheelchair === 'yes' ? '#166534' : selectedPoint?.wheelchair === 'limited' ? '#92400E' : '#991B1B'
                    }}>
                      {selectedPoint?.wheelchair === 'yes' ? 'Entrada acessível' : selectedPoint?.wheelchair === 'limited' ? 'Acesso parcial' : 'Não acessível'}
                    </Text>
                  </View>
                  {placeDetails?.wheelchair_accessible_entrance !== undefined && (
                    <View style={{
                      flexDirection: 'row', alignItems: 'center', gap: 6,
                      backgroundColor: placeDetails.wheelchair_accessible_entrance ? '#DCFCE7' : '#FEE2E2',
                      borderRadius: 20, paddingHorizontal: 12, paddingVertical: 6,
                    }}>
                      <MaterialCommunityIcons name="google" size={12} color={placeDetails.wheelchair_accessible_entrance ? '#16A34A' : '#EF4444'} />
                      <Text style={{ fontSize: 12, fontWeight: '600', color: placeDetails.wheelchair_accessible_entrance ? '#166534' : '#991B1B' }}>
                        {placeDetails.wheelchair_accessible_entrance ? 'Google: acessível' : 'Google: não acessível'}
                      </Text>
                    </View>
                  )}
                </View>
              </View>
            </ScrollView>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },
  topBar: {
    paddingHorizontal: 8,
    paddingBottom: 4,
  },
  backBtn: {
    alignSelf: 'flex-start',
    padding: 8,
  },
  card: {
    marginHorizontal: 16,
    backgroundColor: CARD,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: BORDER,
    paddingVertical: 12,
    paddingHorizontal: 12,
  },
  odRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  leftRail: {
    width: 28,
    alignItems: 'center',
    paddingTop: 4,
  },
  originDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#CBD5E1',
  },
  railLine: {
    flex: 1,
    width: 2,
    minHeight: 28,
    backgroundColor: '#E2E8F0',
    marginVertical: 4,
  },
  odTexts: {
    flex: 1,
    justifyContent: 'center',
    paddingRight: 8,
  },
  odPrimary: {
    fontSize: 15,
    color: TITLE,
    fontFamily: 'Agrandir-TextBold',
  },
  odDivider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: BORDER,
    marginVertical: 10,
  },
  rightActions: {
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 2,
    gap: 4,
  },
  iconGhost: {
    padding: 4,
  },
  swapCircle: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#EBF3FF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: '#BFDBFE',
  },
  swapDisabled: {
    opacity: 0.35,
  },
  cta: {
    marginHorizontal: 16,
    marginTop: 14,
    backgroundColor: PRIMARY,
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ctaDisabled: {
    opacity: 0.7,
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Agrandir-TextBold',
  },
  warn: {
    marginHorizontal: 20,
    marginTop: 8,
    fontSize: 13,
    color: '#B45309',
    fontFamily: 'Agrandir-Regular',
  },
  mapWrap: {
    flex: 1,
    marginTop: 12,
    marginHorizontal: 0,
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    overflow: 'hidden',
    backgroundColor: '#E2E8F0',
  },
  mapPlaceholder: {
    backgroundColor: '#E2E8F0',
  },
  recenter: {
    position: 'absolute',
    right: 16,
    bottom: 40,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: CARD,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: BORDER,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.12,
    shadowRadius: 4,
    elevation: 4,
  },
  originMarker: {
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 2,
    borderColor: '#94A3B8',
  },
});
