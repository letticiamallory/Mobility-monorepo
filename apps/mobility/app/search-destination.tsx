import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScaledText as Text } from '@/components/ScaledText';
import { ScaledTextInput as TextInput } from '@/components/ScaledTextInput';
import { useAccessibilityPreferences, useAccessibilitySurfaces } from '@/contexts/accessibility-preferences';
import { A11Y_HIT_SLOP } from '@/constants/accessibility';
import * as Location from 'expo-location';
import { API_URL } from '../constants/api';
import type { Station } from '../mocks/stations';
import { MOCK_STATIONS } from '../mocks/stations';
import { getHomeFavorites, upsertHomeFavorite, type HomeFavoriteRow } from '../services/home-favorites.service';
import {
  fetchUserRouteHistory,
  sortRouteHistoryNewestFirst,
} from '../services/routes.service';
import { getToken, getUserInfo } from '../services/token.service';
import { inferPlaceIcon } from '../utils/place-icon';

const PRIMARY = '#0057A8';
const BG = '#F5F5F5';
const MUTED = '#6B7280';
const BORDER = '#E5E7EB';
const TITLE = '#111827';

const MAP_FALLBACK = { latitude: -16.7167, longitude: -43.8647 };

const AUTOCOMPLETE_MIN = 2;

type RecentRoute = {
  id: string;
  origin: string;
  destination: string;
  originTitle?: string;
  destinationTitle?: string;
  originAddress?: string;
  destinationAddress?: string;
};

type PlaceSuggestionRow = {
  placeId: string;
  title: string;
  subtitle: string;
  distanceLabel: string;
  fullDescription: string;
  destLat?: number;
  destLng?: number;
};

function calculateDistance(lat1: number, lng1: number, lat2: number, lng2: number): string {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  if (dist < 1000) return `${Math.round(dist)} m`;
  if (dist < 100000) return `${(dist / 1000).toFixed(1)} km`;
  return `${Math.round(dist / 1000)} km`;
}

function calculateDistanceNum(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function parseStations(data: unknown): Station[] {
  if (!Array.isArray(data)) return [];
  return data.map((raw, index) => {
    const row = raw as Record<string, unknown>;
    return {
      id: String(row.id ?? `s-${index}`),
      type: row.type === 'subway' ? 'subway' : 'bus',
      name: String(row.name ?? 'Estação'),
      address: String(row.address ?? '-'),
      distance: String(row.distance ?? '-'),
      distanceNum: Number(row.distanceNum ?? row.distance ?? 0) || 0,
      accessible: row.accessible !== false,
      lines: Array.isArray(row.lines) ? row.lines.map((line) => String(line)) : [],
      nextBus: row.nextBus ? String(row.nextBus) : null,
      lat:
        typeof row.lat === 'number'
          ? row.lat
          : typeof row.latitude === 'number'
            ? row.latitude
            : MAP_FALLBACK.latitude,
      lng:
        typeof row.lng === 'number'
          ? row.lng
          : typeof row.longitude === 'number'
            ? row.longitude
            : MAP_FALLBACK.longitude,
    };
  });
}

function normalizeSearch(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

async function geocodeAddressText(
  address: string,
  key: string,
  bias?: { latitude: number; longitude: number } | null,
): Promise<{ lat: number; lng: number } | null> {
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
    return { lat, lng };
  } catch {
    return null;
  }
}

async function fetchPlaceGeometry(
  placeId: string,
  key: string,
): Promise<{ lat: number; lng: number } | null> {
  try {
    const url =
      'https://maps.googleapis.com/maps/api/place/details/json' +
      `?place_id=${encodeURIComponent(placeId)}` +
      '&fields=geometry' +
      `&key=${encodeURIComponent(key)}`;
    const res = await fetch(url);
    const json = (await res.json()) as {
      result?: { geometry?: { location?: { lat?: number; lng?: number } } };
    };
    const loc = json.result?.geometry?.location;
    const lat = loc?.lat;
    const lng = loc?.lng;
    if (typeof lat !== 'number' || typeof lng !== 'number' || !Number.isFinite(lat) || !Number.isFinite(lng)) {
      return null;
    }
    return { lat, lng };
  } catch {
    return null;
  }
}

function TitleWithHighlight({ text, query }: { text: string; query: string }) {
  const q = query.trim();
  if (!q) {
    return <Text style={styles.rowTitle}>{text}</Text>;
  }
  const lower = text.toLowerCase();
  const idx = lower.indexOf(q.toLowerCase());
  if (idx < 0) {
    return <Text style={styles.rowTitle}>{text}</Text>;
  }
  const before = text.slice(0, idx);
  const match = text.slice(idx, idx + q.length);
  const after = text.slice(idx + q.length);
  return (
    <Text style={styles.rowTitle}>
      {before}
      <Text style={styles.rowTitleMatch}>{match}</Text>
      {after}
    </Text>
  );
}

function paramOne(v: string | string[] | undefined): string {
  if (v == null) return '';
  return Array.isArray(v) ? (v[0] ?? '') : v;
}

export default function SearchDestinationScreen() {
  const { highContrast } = useAccessibilityPreferences();
  const sx = useAccessibilitySurfaces();
  const router = useRouter();
  const navParams = useLocalSearchParams<{
    favoriteFlow?: string;
    favoriteId?: string;
    favoriteAction?: string;
    presetIcon?: string;
    screenTitle?: string;
    origin?: string | string[];
    destination?: string | string[];
    originCoordinate?: string | string[];
    destinationCoordinate?: string | string[];
    originLat?: string | string[];
    originLng?: string | string[];
    destLat?: string | string[];
    destLng?: string | string[];
    editField?: string | string[];
  }>();
  const isFavoriteFlow = navParams.favoriteFlow === '1' || navParams.favoriteFlow === 'true';
  const favoriteIdParam = paramOne(navParams.favoriteId).trim();
  const canQuickSaveToFavoriteCard = isFavoriteFlow && favoriteIdParam.length > 0;
  const [query, setQuery] = useState('');
  const [recentRoutes, setRecentRoutes] = useState<RecentRoute[]>([]);
  const [loadingRecents, setLoadingRecents] = useState(true);
  const [userCoords, setUserCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [allStations, setAllStations] = useState<Station[]>([]);
  const [loadingStations, setLoadingStations] = useState(true);
  const [placeRows, setPlaceRows] = useState<PlaceSuggestionRow[]>([]);
  const [loadingPlaces, setLoadingPlaces] = useState(false);
  const [homeFavorites, setHomeFavorites] = useState<HomeFavoriteRow[]>([]);
  const [loadingHomeFavorites, setLoadingHomeFavorites] = useState(true);
  const [savingStarKey, setSavingStarKey] = useState<string | null>(null);
  const savingFavorite = savingStarKey != null;

  const hasQuery = query.trim().length > 0;
  const qNorm = normalizeSearch(query);

  // Evita abrir `route-results` vazio: vai para `route-plan` (que faz loading + pré-busca)
  // e só navega para `route-results` quando os cards estiverem prontos.
  const goToResults = useCallback(
    (destination: string, origin?: string) => {
      router.push({
        pathname: '/route-plan',
        params: {
          destination: destination.trim(),
          ...(origin ? { origin: origin.trim() } : {}),
        },
      });
    },
    [router],
  );

  const reloadHomeFavorites = useCallback(async () => {
    try {
      setLoadingHomeFavorites(true);
      setHomeFavorites(await getHomeFavorites());
    } finally {
      setLoadingHomeFavorites(false);
    }
  }, []);

  const goToRoutePlan = useCallback(
    (p: { destination: string; destLat?: number; destLng?: number }) => {
      const rp: Record<string, string> = { destination: p.destination.trim() };
      if (p.destLat != null && p.destLng != null && Number.isFinite(p.destLat) && Number.isFinite(p.destLng)) {
        rp.destLat = String(p.destLat);
        rp.destLng = String(p.destLng);
      }
      router.push({ pathname: '/route-plan', params: rp });
    },
    [router],
  );

  const openRecentTripOnRoutePlan = useCallback(
    (destination: string, origin: string) => {
      router.push({
        pathname: '/route-plan',
        params: {
          destination: destination.trim(),
          origin: origin.trim(),
        },
      });
    },
    [router],
  );

  const planEditField = useMemo((): 'origin' | 'destination' => {
    const raw = paramOne(navParams.editField).trim().toLowerCase();
    return raw === 'origin' ? 'origin' : 'destination';
  }, [navParams.editField]);

  const isRoutePlanEdit = useMemo(
    () => paramOne(navParams.editField).trim().length > 0,
    [navParams.editField],
  );

  const searchPlaceholder = useMemo(
    () =>
      isRoutePlanEdit
        ? planEditField === 'origin'
          ? 'De onde você sai?'
          : 'Para onde você quer ir?'
        : 'Para onde você quer ir?',
    [isRoutePlanEdit, planEditField],
  );

  useEffect(() => {
    const ef = paramOne(navParams.editField).trim();
    if (!ef) return;
    if (ef.toLowerCase() === 'origin') {
      setQuery(paramOne(navParams.origin));
    } else {
      setQuery(paramOne(navParams.destination));
    }
  }, [navParams.editField, navParams.origin, navParams.destination]);

  const pickPlaceForRoutePlan = useCallback(
    (fullDescription: string, lat: number, lng: number) => {
      if (!isRoutePlanEdit) {
        goToRoutePlan({ destination: fullDescription, destLat: lat, destLng: lng });
        return;
      }
      const baseO = paramOne(navParams.origin).trim();
      const baseD = paramOne(navParams.destination).trim();
      const rp: Record<string, string> = {};
      if (planEditField === 'origin') {
        rp.origin = fullDescription;
        rp.destination = baseD;
        rp.originLat = String(lat);
        rp.originLng = String(lng);
        const dc = paramOne(navParams.destinationCoordinate);
        if (dc) rp.destinationCoordinate = dc;
        const dLat = paramOne(navParams.destLat).trim();
        const dLng = paramOne(navParams.destLng).trim();
        if (dLat && dLng) {
          rp.destLat = dLat;
          rp.destLng = dLng;
        }
      } else {
        rp.destination = fullDescription;
        rp.destLat = String(lat);
        rp.destLng = String(lng);
        if (baseO) rp.origin = baseO;
        const oc = paramOne(navParams.originCoordinate);
        if (oc) rp.originCoordinate = oc;
        const oLat = paramOne(navParams.originLat).trim();
        const oLng = paramOne(navParams.originLng).trim();
        if (oLat && oLng) {
          rp.originLat = oLat;
          rp.originLng = oLng;
        }
      }
      router.push({ pathname: '/route-plan', params: rp });
    },
    [isRoutePlanEdit, planEditField, navParams, router, goToRoutePlan],
  );

  const goFavoriteConfirm = useCallback(
    (p: { address: string; lat: number; lng: number; inferredIcon?: string }) => {
      router.push({
        pathname: '/favorite-location-confirm',
        params: {
          address: p.address,
          lat: String(p.lat),
          lng: String(p.lng),
          favoriteId: paramOne(navParams.favoriteId),
          favoriteAction: paramOne(navParams.favoriteAction),
          presetIcon: paramOne(navParams.presetIcon),
          screenTitle: paramOne(navParams.screenTitle),
          inferredIcon: p.inferredIcon ?? inferPlaceIcon(p.address),
        },
      });
    },
    [router, navParams.favoriteId, navParams.favoriteAction, navParams.presetIcon, navParams.screenTitle],
  );

  const quickSaveToFavoriteCard = useCallback(
    async (
      p: { address: string; lat: number; lng: number; inferredIcon?: string },
      starKey: string,
    ) => {
      const favId = favoriteIdParam;
      if (!favId) return;
      if (!Number.isFinite(p.lat) || !Number.isFinite(p.lng) || !p.address?.trim()) return;
      setSavingStarKey(starKey);
      try {
        const existing = homeFavorites.find((x) => String(x.id).trim() === favId);
        const presetIcon = paramOne(navParams.presetIcon).trim();
        const iconUsed =
          presetIcon ||
          existing?.icon ||
          (p.inferredIcon ?? (inferPlaceIcon(p.address) as string));

        await upsertHomeFavorite({
          id: favId,
          label: existing?.label || 'Favorito',
          subtitle: undefined,
          icon: iconUsed,
          address: p.address,
          lat: p.lat,
          lng: p.lng,
          isPreset: existing?.isPreset ?? false,
        });
        router.replace('/home');
      } finally {
        setSavingStarKey(null);
      }
    },
    [favoriteIdParam, homeFavorites, navParams.presetIcon, router],
  );

  const openPlaceForFlow = useCallback(
    async (item: PlaceSuggestionRow) => {
      if (isFavoriteFlow) {
        let la = item.destLat;
        let ln = item.destLng;
        if (la == null || ln == null) {
          const key = process.env.EXPO_PUBLIC_GOOGLE_API_KEY?.trim();
          if (key) {
            const g = await fetchPlaceGeometry(item.placeId, key);
            if (g) {
              la = g.lat;
              ln = g.lng;
            }
          }
        }
        if (la != null && ln != null && Number.isFinite(la) && Number.isFinite(ln)) {
          goFavoriteConfirm({
            address: item.fullDescription,
            lat: la,
            lng: ln,
            inferredIcon: inferPlaceIcon(item.fullDescription) as string,
          });
          return;
        }
        Alert.alert(
          'Local incompleto',
          'Não foi possível obter as coordenadas deste lugar. Tente outro resultado da lista ou verifique a chave do Google Places.',
        );
        return;
      }
      if (item.destLat != null && item.destLng != null && Number.isFinite(item.destLat) && Number.isFinite(item.destLng)) {
        pickPlaceForRoutePlan(item.fullDescription, item.destLat, item.destLng);
        return;
      }
      void (async () => {
        const key = process.env.EXPO_PUBLIC_GOOGLE_API_KEY?.trim();
        if (!key) return;
        const g = await fetchPlaceGeometry(item.placeId, key);
        if (g) pickPlaceForRoutePlan(item.fullDescription, g.lat, g.lng);
      })();
    },
    [goFavoriteConfirm, pickPlaceForRoutePlan, isFavoriteFlow],
  );

  const quickSavePlaceRow = useCallback(
    async (item: PlaceSuggestionRow) => {
      if (!canQuickSaveToFavoriteCard) return;
      let la = item.destLat;
      let ln = item.destLng;
      if (la == null || ln == null) {
        const key = process.env.EXPO_PUBLIC_GOOGLE_API_KEY?.trim();
        if (key) {
          const g = await fetchPlaceGeometry(item.placeId, key);
          if (g) {
            la = g.lat;
            ln = g.lng;
          }
        }
      }
      if (la != null && ln != null && Number.isFinite(la) && Number.isFinite(ln)) {
        await quickSaveToFavoriteCard(
          {
            address: item.fullDescription,
            lat: la,
            lng: ln,
            inferredIcon: inferPlaceIcon(item.fullDescription) as string,
          },
          `place:${item.placeId}`,
        );
      }
    },
    [canQuickSaveToFavoriteCard, quickSaveToFavoriteCard],
  );

  useEffect(() => {
    const loadLocationAndStations = async () => {
      try {
        setLoadingStations(true);
        const permission = await Location.requestForegroundPermissionsAsync();
        let lat = MAP_FALLBACK.latitude;
        let lng = MAP_FALLBACK.longitude;
        if (permission.status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({});
          lat = pos.coords.latitude;
          lng = pos.coords.longitude;
          setUserCoords({ latitude: lat, longitude: lng });
        } else {
          setUserCoords(null);
        }
        const response = await fetch(`${API_URL}/stations/nearby?lat=${lat}&lng=${lng}`);
        const data = response.ok ? ((await response.json()) as unknown) : [];
        const parsed = parseStations(data);
        setAllStations(parsed.length > 0 ? parsed : MOCK_STATIONS);
      } catch {
        setAllStations(MOCK_STATIONS);
      } finally {
        setLoadingStations(false);
      }
    };
    loadLocationAndStations();
  }, []);

  const loadRecentRoutes = useCallback(async () => {
    try {
      setLoadingRecents(true);
      const token = await getToken();
      const { userId } = await getUserInfo();
      if (!token || userId == null) {
        setRecentRoutes([]);
        return;
      }
      const list = await fetchUserRouteHistory(token, userId);
      const sorted = sortRouteHistoryNewestFirst(list);
      const mapped = sorted.slice(0, 8).map((item) => ({
        id: String(item.id),
        origin: item.origin?.trim() ?? '',
        destination: item.destination?.trim() || 'Destino',
        originTitle: (item.originTitle ?? item.origin_title)?.trim() || undefined,
        destinationTitle: (item.destinationTitle ?? item.destination_title)?.trim() || undefined,
        originAddress: (item.originAddress ?? item.origin_address)?.trim() || undefined,
        destinationAddress: (item.destinationAddress ?? item.destination_address)?.trim() || undefined,
      }));
      setRecentRoutes(mapped);
    } catch {
      setRecentRoutes([]);
    } finally {
      setLoadingRecents(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      void reloadHomeFavorites();
      void loadRecentRoutes();
    }, [reloadHomeFavorites, loadRecentRoutes]),
  );

  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < AUTOCOMPLETE_MIN) {
      setPlaceRows([]);
      setLoadingPlaces(false);
      return;
    }
    const key = process.env.EXPO_PUBLIC_GOOGLE_API_KEY?.trim();
    if (!key) {
      setPlaceRows([]);
      setLoadingPlaces(false);
      return;
    }

    let cancelled = false;
    setLoadingPlaces(true);
    const timeoutId = setTimeout(async () => {
      try {
        let url =
          'https://maps.googleapis.com/maps/api/place/autocomplete/json' +
          `?input=${encodeURIComponent(trimmed)}` +
          '&language=pt-BR' +
          '&types=geocode' +
          '&region=br';
        if (userCoords != null) {
          url += `&location=${userCoords.latitude},${userCoords.longitude}&radius=100000`;
        }
        url += `&key=${encodeURIComponent(key)}`;
        const res = await fetch(url);
        const json = (await res.json()) as {
          predictions?: {
            description?: string;
            place_id?: string;
            structured_formatting?: { main_text?: string; secondary_text?: string };
          }[];
        };
        if (cancelled) return;
        const preds = (json.predictions ?? [])
          .map((p) => ({
            description: String(p.description ?? '').trim(),
            placeId: String(p.place_id ?? '').trim(),
            main: String(p.structured_formatting?.main_text ?? p.description ?? '').trim(),
            secondary: String(p.structured_formatting?.secondary_text ?? '').trim(),
          }))
          .filter((p) => p.description && p.placeId)
          .slice(0, 6);

        const lat0 = userCoords?.latitude ?? MAP_FALLBACK.latitude;
        const lng0 = userCoords?.longitude ?? MAP_FALLBACK.longitude;

        const rows: PlaceSuggestionRow[] = [];
        for (const p of preds) {
          if (cancelled) return;
          const geom = await fetchPlaceGeometry(p.placeId, key);
          const distanceLabel = geom
            ? calculateDistance(lat0, lng0, geom.lat, geom.lng)
            : '—';
          rows.push({
            placeId: p.placeId,
            title: p.main || p.description,
            subtitle: p.secondary,
            distanceLabel,
            fullDescription: p.description,
            ...(geom ? { destLat: geom.lat, destLng: geom.lng } : {}),
          });
        }
        rows.sort((a, b) => {
          const da =
            a.destLat != null && a.destLng != null
              ? calculateDistanceNum(lat0, lng0, a.destLat, a.destLng)
              : Number.POSITIVE_INFINITY;
          const db =
            b.destLat != null && b.destLng != null
              ? calculateDistanceNum(lat0, lng0, b.destLat, b.destLng)
              : Number.POSITIVE_INFINITY;
          return da - db;
        });
        if (!cancelled) setPlaceRows(rows);
      } catch {
        if (!cancelled) setPlaceRows([]);
      } finally {
        if (!cancelled) setLoadingPlaces(false);
      }
    }, 280);

    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [query, userCoords?.latitude, userCoords?.longitude]);

  const stationSuggestions = useMemo(() => {
    if (!hasQuery || !qNorm || query.trim().length < AUTOCOMPLETE_MIN) return [];
    const lat0 = userCoords?.latitude ?? MAP_FALLBACK.latitude;
    const lng0 = userCoords?.longitude ?? MAP_FALLBACK.longitude;
    return [...allStations]
      .filter((s) => {
        const n = normalizeSearch(s.name);
        const a = normalizeSearch(s.address);
        return n.includes(qNorm) || a.includes(qNorm) || normalizeSearch(`${s.name} ${s.address}`).includes(qNorm);
      })
      .map((s) => ({
        station: s,
        distNum: calculateDistanceNum(lat0, lng0, s.lat, s.lng),
      }))
      .sort((x, y) => x.distNum - y.distNum)
      .slice(0, 8)
      .map(({ station, distNum }) => ({
        station,
        distanceLabel:
          userCoords != null
            ? calculateDistance(userCoords.latitude, userCoords.longitude, station.lat, station.lng)
            : distNum < 1000
              ? `${Math.round(distNum)} m`
              : `${(distNum / 1000).toFixed(1)} km`,
      }));
  }, [allStations, hasQuery, qNorm, query, userCoords]);

  return (
    <SafeAreaView style={[styles.safe, sx.fillScreen]} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle={highContrast ? 'light-content' : 'dark-content'} />
      <KeyboardAvoidingView
        style={[styles.flex, sx.fillScreen]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <View style={[styles.headerRow, sx.fillScreen]}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={A11Y_HIT_SLOP}
            style={styles.headerIconBtn}
            accessibilityRole="button"
            accessibilityLabel="Voltar"
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color={TITLE} />
          </TouchableOpacity>
          <TextInput
            testID="input-destino"
            style={[styles.searchInput, sx.fillCard, sx.outlineBorder]}
            placeholder={searchPlaceholder}
            placeholderTextColor="#9CA3AF"
            value={query}
            onChangeText={setQuery}
            returnKeyType="search"
            onSubmitEditing={() => {
              const t = query.trim();
              if (!t) return;
              if (isFavoriteFlow && !isRoutePlanEdit) {
                void (async () => {
                  const key = process.env.EXPO_PUBLIC_GOOGLE_API_KEY?.trim();
                  if (!key) return;
                  const loc = await geocodeAddressText(t, key, userCoords);
                  if (loc) {
                    goFavoriteConfirm({
                      address: t,
                      lat: loc.lat,
                      lng: loc.lng,
                      inferredIcon: inferPlaceIcon(t) as string,
                    });
                  }
                })();
                return;
              }
              if (!isRoutePlanEdit) {
                goToResults(t);
                return;
              }
              void (async () => {
                const key = process.env.EXPO_PUBLIC_GOOGLE_API_KEY?.trim();
                if (!key) return;
                const loc = await geocodeAddressText(t, key, userCoords);
                if (loc) pickPlaceForRoutePlan(t, loc.lat, loc.lng);
              })();
            }}
            autoCorrect={false}
            autoCapitalize="sentences"
            accessibilityLabel={
              isRoutePlanEdit
                ? planEditField === 'origin'
                  ? 'Origem da viagem'
                  : 'Destino da viagem'
                : 'Destino da viagem'
            }
            accessibilityHint={
              isRoutePlanEdit
                ? planEditField === 'origin'
                  ? 'Digite o endereço de partida e confirme'
                  : 'Digite para onde deseja ir e confirme'
                : 'Digite para onde deseja ir e confirme para buscar rotas'
            }
            importantForAccessibility="yes"
          />
          {hasQuery ? (
            <TouchableOpacity
              onPress={() => setQuery('')}
              hitSlop={A11Y_HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel="Limpar busca"
            >
              <MaterialCommunityIcons name="close-circle" size={22} color="#9CA3AF" />
            </TouchableOpacity>
          ) : null}
        </View>

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.scrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {!hasQuery ? (
            <>
              <TouchableOpacity
                style={styles.lineSearchRow}
                onPress={() => router.push('/lines')}
                activeOpacity={0.75}
                accessibilityRole="button"
                accessibilityLabel="Procure uma linha de transporte"
              >
                <MaterialCommunityIcons name="transit-connection-variant" size={22} color={PRIMARY} />
                <Text style={styles.linkBlue}>Procure uma linha</Text>
              </TouchableOpacity>

              {!isFavoriteFlow ? (
                <>
                  <View style={styles.sectionHead}>
                    <Text style={styles.sectionTitleMuted}>Favoritos</Text>
                    <TouchableOpacity
                      activeOpacity={0.75}
                      onPress={() => router.push('/home')}
                      hitSlop={A11Y_HIT_SLOP}
                      accessibilityRole="button"
                      accessibilityLabel="Adicionar favorito na página inicial"
                    >
                      <Text style={styles.linkBlue}>+ Adicionar</Text>
                    </TouchableOpacity>
                  </View>
                  {loadingHomeFavorites ? (
                    <Text style={styles.loadingRecents}>Carregando favoritos…</Text>
                  ) : homeFavorites.length === 0 ? (
                    <TouchableOpacity
                      style={styles.emptyFavoritesWrap}
                      onPress={() => router.push('/home')}
                      activeOpacity={0.75}
                      accessibilityRole="button"
                      accessibilityLabel="Ir à página inicial para adicionar favoritos"
                    >
                      <Text style={styles.emptyFavoritesText}>
                        Você ainda não tem favoritos na página inicial. Lá você pode tocar em{' '}
                        <Text style={styles.emptyFavoritesEm}>Adicionar</Text> na seção Favoritos para cadastrar
                        lugares. Toque aqui para ir à página inicial.
                      </Text>
                    </TouchableOpacity>
                  ) : (
                    homeFavorites.map((item, index) => (
                      <View key={item.id}>
                        <TouchableOpacity
                          style={styles.rowPad}
                          onPress={() =>
                            goToRoutePlan({
                              destination: item.address,
                              destLat: item.lat,
                              destLng: item.lng,
                            })
                          }
                          activeOpacity={0.75}
                          accessibilityRole="button"
                          accessibilityLabel={`Favorito: ${item.label}. ${item.subtitle || item.address}`}
                        >
                          <MaterialCommunityIcons
                            name={item.icon as keyof typeof MaterialCommunityIcons.glyphMap}
                            size={24}
                            color="#4B5563"
                          />
                          <View style={styles.rowBody}>
                            <Text style={styles.rowTitle}>{item.label}</Text>
                            <Text style={styles.rowSub} numberOfLines={2}>
                              {item.subtitle ||
                                (item.address.length > 48 ? `${item.address.slice(0, 48)}…` : item.address)}
                            </Text>
                          </View>
                          <MaterialCommunityIcons name="chevron-right" size={22} color="#9CA3AF" />
                        </TouchableOpacity>
                        {index < homeFavorites.length - 1 ? <View style={styles.divider} /> : null}
                      </View>
                    ))
                  )}
                </>
              ) : null}

              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitleMuted}>Recentes</Text>
                <View accessible={false} importantForAccessibility="no-hide-descendants">
                  <MaterialCommunityIcons name="dots-vertical" size={22} color="#9CA3AF" />
                </View>
              </View>
              {loadingRecents ? (
                <Text style={styles.loadingRecents}>Carregando…</Text>
              ) : recentRoutes.length === 0 ? (
                <Text style={styles.emptyRecents}>Nenhuma viagem recente</Text>
              ) : (
                recentRoutes.map((route, index) => (
                  <View key={route.id}>
                    <TouchableOpacity
                      style={styles.rowPad}
                      onPress={() =>
                        openRecentTripOnRoutePlan(
                          route.destinationAddress?.trim() || route.destination,
                          route.originAddress?.trim() || route.origin,
                        )
                      }
                      activeOpacity={0.75}
                      accessibilityRole="button"
                      accessibilityLabel={
                        route.origin
                          ? `Viagem recente para ${route.destinationAddress?.trim() || route.destination}, partindo de ${route.originAddress?.trim() || route.origin}`
                          : `Viagem recente para ${route.destinationAddress?.trim() || route.destination}`
                      }
                    >
                      <MaterialCommunityIcons name="shopping-outline" size={22} color="#9CA3AF" />
                      <View style={styles.rowBody}>
                        <Text style={styles.rowTitle}>
                          {route.destinationAddress?.trim() || route.destination}
                        </Text>
                        {route.origin ? (
                          <Text style={styles.rowSub}>
                            {route.originAddress?.trim() || route.origin}
                          </Text>
                        ) : null}
                      </View>
                    </TouchableOpacity>
                    {index < recentRoutes.length - 1 ? <View style={styles.divider} /> : null}
                  </View>
                ))
              )}
            </>
          ) : (
            <>
              <View style={styles.sectionHead}>
                <Text style={styles.sectionTitleMuted}>Locais</Text>
              </View>

              {query.trim().length < AUTOCOMPLETE_MIN ? (
                <Text style={styles.hintMuted}>
                  Digite pelo menos {AUTOCOMPLETE_MIN} caracteres para ver sugestões de locais e estações.
                </Text>
              ) : !process.env.EXPO_PUBLIC_GOOGLE_API_KEY?.trim() ? (
                <Text style={styles.hintMuted}>
                  Sugestões de locais precisam da variável EXPO_PUBLIC_GOOGLE_API_KEY.
                </Text>
              ) : loadingPlaces ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={PRIMARY} />
                  <Text style={styles.loadingPlacesText}>Buscando locais…</Text>
                </View>
              ) : placeRows.length === 0 ? (
                <Text style={styles.hintMuted}>Nenhum local encontrado.</Text>
              ) : (
                placeRows.map((item, index) => (
                  <View key={item.placeId}>
                    <TouchableOpacity
                      style={styles.rowPad}
                      onPress={() => {
                        if (isFavoriteFlow) {
                          void openPlaceForFlow(item);
                          return;
                        }
                        if (
                          item.destLat != null &&
                          item.destLng != null &&
                          Number.isFinite(item.destLat) &&
                          Number.isFinite(item.destLng)
                        ) {
                          pickPlaceForRoutePlan(item.fullDescription, item.destLat, item.destLng);
                          return;
                        }
                        void openPlaceForFlow(item);
                      }}
                      activeOpacity={0.75}
                      accessibilityRole="button"
                      accessibilityLabel={`${item.title}. ${item.subtitle || item.fullDescription}. Distância ${item.distanceLabel}`}
                    >
                      <View style={styles.rowLeftCol}>
                        <MaterialCommunityIcons
                          name={inferPlaceIcon(item.fullDescription)}
                          size={22}
                          color="#9CA3AF"
                        />
                        <Text style={styles.distanceBlue}>{item.distanceLabel}</Text>
                      </View>
                      <View style={styles.rowBody}>
                        <TitleWithHighlight text={item.title} query={query} />
                        {item.subtitle ? <Text style={styles.rowSub}>{item.subtitle}</Text> : null}
                      </View>
                      {canQuickSaveToFavoriteCard ? (
                        <TouchableOpacity
                          style={styles.starBtn}
                          onPress={() => void quickSavePlaceRow(item)}
                          disabled={savingFavorite}
                          hitSlop={A11Y_HIT_SLOP}
                          accessibilityRole="button"
                          accessibilityLabel={`Salvar ${item.title} no favorito`}
                          accessibilityState={{ disabled: savingFavorite }}
                        >
                          <MaterialCommunityIcons
                            name={savingStarKey === `place:${item.placeId}` ? 'star' : 'star-outline'}
                            size={22}
                            color={savingStarKey === `place:${item.placeId}` ? PRIMARY : '#9CA3AF'}
                          />
                        </TouchableOpacity>
                      ) : (
                        <MaterialCommunityIcons name="open-in-new" size={20} color="#9CA3AF" />
                      )}
                    </TouchableOpacity>
                    {index < placeRows.length - 1 ? <View style={styles.divider} /> : null}
                  </View>
                ))
              )}

              {query.trim().length >= AUTOCOMPLETE_MIN ? (
                <Text style={[styles.sectionTitleMuted, styles.sectionSpacer]}>Estações</Text>
              ) : null}
              {query.trim().length < AUTOCOMPLETE_MIN ? null : loadingStations ? (
                <View style={styles.loadingRow}>
                  <ActivityIndicator color={PRIMARY} />
                  <Text style={styles.loadingPlacesText}>Carregando estações…</Text>
                </View>
              ) : stationSuggestions.length === 0 ? (
                <Text style={styles.hintMuted}>Nenhuma estação corresponde à sua busca.</Text>
              ) : (
                stationSuggestions.map(({ station, distanceLabel }, index) => (
                  <View key={station.id}>
                    <TouchableOpacity
                      style={styles.rowPad}
                      onPress={() => {
                        const dest = `${station.name} — ${station.address}`;
                        if (isFavoriteFlow) {
                          goFavoriteConfirm({
                            address: dest,
                            lat: station.lat,
                            lng: station.lng,
                            inferredIcon: 'bus',
                          });
                          return;
                        }
                        pickPlaceForRoutePlan(dest, station.lat, station.lng);
                      }}
                      activeOpacity={0.75}
                      accessibilityRole="button"
                      accessibilityLabel={`Estação ${station.name}, ${station.address}. Distância ${distanceLabel}`}
                    >
                      <View style={styles.rowLeftCol}>
                        <View style={styles.busTile}>
                          <MaterialCommunityIcons name="bus" size={18} color="#FFFFFF" />
                        </View>
                        <Text style={styles.distanceBlue}>{distanceLabel}</Text>
                      </View>
                      <View style={styles.rowBody}>
                        <TitleWithHighlight text={station.name} query={query} />
                        <Text style={styles.rowSub}>{station.address}</Text>
                      </View>
                      {canQuickSaveToFavoriteCard ? (
                        <TouchableOpacity
                          style={styles.starBtn}
                          onPress={() => {
                            const addr = `${station.name} — ${station.address}`;
                            void quickSaveToFavoriteCard(
                              {
                                address: addr,
                                lat: station.lat,
                                lng: station.lng,
                                inferredIcon: station.type === 'subway' ? 'subway-variant' : 'bus',
                              },
                              `station:${station.id}`,
                            );
                          }}
                          disabled={savingFavorite}
                          hitSlop={A11Y_HIT_SLOP}
                          accessibilityRole="button"
                          accessibilityLabel={`Salvar estação ${station.name} no favorito`}
                          accessibilityState={{ disabled: savingFavorite }}
                        >
                          <MaterialCommunityIcons
                            name={savingStarKey === `station:${station.id}` ? 'star' : 'star-outline'}
                            size={22}
                            color={savingStarKey === `station:${station.id}` ? PRIMARY : '#9CA3AF'}
                          />
                        </TouchableOpacity>
                      ) : (
                        <MaterialCommunityIcons
                          name="clipboard-text-clock-outline"
                          size={22}
                          color="#9CA3AF"
                        />
                      )}
                    </TouchableOpacity>
                    {index < stationSuggestions.length - 1 ? <View style={styles.divider} /> : null}
                  </View>
                ))
              )}
            </>
          )}

        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },
  flex: {
    flex: 1,
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    gap: 8,
    backgroundColor: BG,
  },
  headerIconBtn: {
    padding: 4,
  },
  searchInput: {
    flex: 1,
    height: 44,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: BORDER,
    paddingHorizontal: 14,
    fontSize: 15,
    color: TITLE,
    fontFamily: 'Agrandir-Regular',
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingBottom: 32,
    paddingHorizontal: 16,
  },
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 16,
    marginBottom: 8,
  },
  sectionTitleMuted: {
    fontSize: 14,
    color: MUTED,
    fontFamily: 'Agrandir-TextBold',
  },
  sectionSpacer: {
    marginTop: 20,
    marginBottom: 8,
  },
  sectionLinkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  linkBlue: {
    color: PRIMARY,
    fontSize: 14,
    fontFamily: 'Agrandir-TextBold',
  },
  rowPad: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    gap: 12,
  },
  starBtn: {
    paddingLeft: 8,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowLeftCol: {
    alignItems: 'center',
    width: 48,
  },
  busTile: {
    width: 36,
    height: 36,
    borderRadius: 6,
    backgroundColor: PRIMARY,
    alignItems: 'center',
    justifyContent: 'center',
  },
  distanceBlue: {
    marginTop: 4,
    fontSize: 11,
    color: PRIMARY,
    fontFamily: 'Agrandir-TextBold',
  },
  rowBody: {
    flex: 1,
    minWidth: 0,
  },
  rowTitle: {
    fontSize: 15,
    color: TITLE,
    fontFamily: 'Agrandir-TextBold',
  },
  rowTitleMatch: {
    fontSize: 15,
    color: PRIMARY,
    fontFamily: 'Agrandir-TextBold',
  },
  rowSub: {
    marginTop: 2,
    fontSize: 13,
    color: MUTED,
    fontFamily: 'Agrandir-Regular',
  },
  tapEdit: {
    marginTop: 2,
    fontSize: 13,
    color: PRIMARY,
    fontFamily: 'Agrandir-Regular',
  },
  divider: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: BORDER,
    marginLeft: 60,
  },
  lineSearchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginTop: 8,
    paddingVertical: 6,
  },
  loadingRecents: {
    color: MUTED,
    fontSize: 14,
    fontFamily: 'Agrandir-Regular',
    paddingVertical: 8,
  },
  emptyRecents: {
    color: MUTED,
    fontSize: 14,
    fontFamily: 'Agrandir-Regular',
    paddingVertical: 8,
  },
  emptyFavoritesWrap: {
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  emptyFavoritesText: {
    color: MUTED,
    fontSize: 14,
    lineHeight: 20,
    fontFamily: 'Agrandir-Regular',
  },
  emptyFavoritesEm: {
    color: PRIMARY,
    fontFamily: 'Agrandir-TextBold',
  },
  hintMuted: {
    color: MUTED,
    fontSize: 14,
    fontFamily: 'Agrandir-Regular',
    paddingVertical: 6,
    marginBottom: 4,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingVertical: 12,
  },
  loadingPlacesText: {
    color: MUTED,
    fontSize: 14,
    fontFamily: 'Agrandir-Regular',
  },
});
