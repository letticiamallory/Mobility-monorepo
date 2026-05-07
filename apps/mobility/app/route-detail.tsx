import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import * as Haptics from 'expo-haptics';
import * as Speech from 'expo-speech';
import { Image as ExpoImage } from 'expo-image';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Alert,
  Animated,
  Dimensions,
  PanResponder,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { ScaledText as Text } from '@/components/ScaledText';
import { useAccessibilityPreferences, useAccessibilitySurfaces } from '@/contexts/accessibility-preferences';
import { regionsWithActiveFeedAt } from '@/constants/br-transit-realtime';
import { useLiveTransitVehicles } from '@/hooks/useLiveTransitVehicles';
import { useRouteLiveNavigation } from '@/hooks/useRouteLiveNavigation';
import { ensureJourneyNotificationPermission } from '@/services/journey-notifications';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

export type RouteStage = {
  mode: 'walk' | 'bus' | 'subway';
  instruction: string;
  distance: string;
  duration: string;
  departure_time?: string;
  arrival_time?: string;
  departureTime?: string;
  arrivalTime?: string;
  departure_minutes?: number | string | Array<number | string>;
  transit_departure_unix?: number;
  accessible: boolean;
  warning?: string;
  street_view_image?: string;
  segment_images?: string[];
  slope_warning?: boolean;
  line_code?: string;
  points?: { latitude: number; longitude: number }[];
};

export type SerializedRouteDetail = {
  origin: string;
  destination: string;
  totalTime: string;
  originCoordinate: { latitude: number; longitude: number };
  destinationCoordinate: { latitude: number; longitude: number };
  stages: RouteStage[];
  /** Tarifa estimada, ex.: "9,30" ou "R$ 9,30" — opcional. */
  price?: string;
  weather?: {
    rain?: number;
  };
};

export type MapRegion = {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
};

type LatLng = { latitude: number; longitude: number };

const COLORS = {
  bg: '#FFFFFF',
  primary: '#0057A8',
  text: '#1E1D1D',
  textMuted: '#6B7280',
  lineGrey: '#CCCCCC',
  orangeOrigin: '#FF6B00',
  redDest: '#EF4444',
  badgeBg: '#1E1D1D',
  greenOnTime: '#16A34A',
  orangeLate: '#EA580C',
  yellowCard: '#FEF3C7',
  yellowBorder: '#FDE68A',
  yellowText: '#92400E',
  transitLine: '#22c55e',
  walkLine: '#F97316',
  purpleTip: '#7C3AED',
  purpleTipBg: '#EDE9FE',
};

const LINE_PALETTE = [
  '#E53935', '#FB8C00', '#43A047', '#1E88E5',
  '#8E24AA', '#00897B', '#F4511E', '#D81B60',
];

function getLineAccentColor(code: string): string {
  const hash = code.split('').reduce((acc, ch) => acc + ch.charCodeAt(0), 0);
  return LINE_PALETTE[hash % LINE_PALETTE.length];
}

function toMinutes(duration: string): number {
  const h = duration.match(/(\d+)\s*h/i);
  const m = duration.match(/(\d+)\s*min/i);
  const fromLabel = (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
  if (fromLabel > 0) return fromLabel;
  const onlyNumber = duration.match(/\d+/)?.[0];
  return onlyNumber ? Number(onlyNumber) : 0;
}

function formatAsHoursMinutes(totalMinutes: number): string {
  const safe = Math.max(0, Math.floor(totalMinutes));
  const hours = Math.floor(safe / 60);
  const minutes = safe % 60;
  return `${hours}h ${String(minutes).padStart(2, '0')}min`;
}

function stripEstimado(text: string): string {
  return text.replace(/\bestimado\b/gi, '').replace(/\s+/g, ' ').trim();
}

/** Duração total só em minutos para o topo do card (sem "estimado"). */
function formatTotalTripMinutesLabel(totalTimeRaw: string): string {
  const cleaned = stripEstimado(totalTimeRaw);
  const mins = toMinutes(cleaned);
  if (mins > 0) return formatAsHoursMinutes(mins);
  return '—';
}

function formatClock(date: Date): string {
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

function extractLineCode(stage: RouteStage): string {
  if (stage.line_code?.trim()) return stage.line_code.trim();
  const first = stage.instruction.trim().split(/\s+/)[0];
  return first && /^[\w.]/.test(first) ? first : '---';
}

function extractBoardingPlace(instruction: string): string {
  const raw = instruction.trim();
  if (!raw) return 'Embarque';
  const withoutArrow = raw.split(/->|→/)[0]?.trim() ?? raw;
  const withoutDestination = withoutArrow.split('/')[0]?.trim() ?? withoutArrow;
  const place = withoutDestination.split('|')[0]?.trim() ?? withoutDestination;
  return place || 'Embarque';
}

function extractDropoffPlace(instruction: string): string {
  const raw = instruction.trim();
  if (!raw) return 'estação';
  const afterCode = raw.split(/\s+/).slice(1).join(' ').trim();
  const source = afterCode || raw;
  const base = source.split(/->|→/)[0]?.trim() || source;
  const place = base.split('/')[0]?.trim() ?? base;
  return place || 'estação';
}

/** Mesma paleta/hash que `getLineColor` em route-results (faixa sob o código da linha). */
function getRouteCardLineStripeColor(code: string): string {
  const colors = [
    '#E53935', '#FB8C00', '#43A047', '#1E88E5',
    '#8E24AA', '#00897B', '#F4511E', '#D81B60',
    '#6D4C41', '#546E7A', '#039BE5', '#7CB342',
    '#FFB300', '#3949AB', '#00ACC1', '#E91E63',
  ];
  const hash = code.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

function getTransitInstructionColor(stage?: RouteStage): string {
  if (!stage || (stage.mode !== 'bus' && stage.mode !== 'subway')) return COLORS.lineGrey;
  return getRouteCardLineStripeColor(extractLineCode(stage));
}

function isWalkStageMode(mode?: string): boolean {
  const m = `${mode ?? ''}`.toLowerCase();
  return m === 'walk' || m === 'walking';
}

type RouteRainHint =
  | { show: false }
  | {
      show: true;
      heavy: boolean;
      icon: 'weather-rainy' | 'weather-pouring';
      label: string;
      iconColor: string;
      textColor: string;
    };

function routeRainHint(route: SerializedRouteDetail | null): RouteRainHint {
  if (!route?.weather || typeof route.weather !== 'object') return { show: false };
  const rain = Number((route.weather as { rain?: unknown }).rain ?? 0);
  if (!Number.isFinite(rain) || rain <= 0) return { show: false };
  const heavy = rain > 5;
  if (heavy) {
    return {
      show: true,
      heavy: true,
      icon: 'weather-pouring',
      label: 'Chuva forte no trajeto, cuidado no percurso',
      iconColor: '#EF4444',
      textColor: '#B91C1C',
    };
  }
  return {
    show: true,
    heavy: false,
    icon: 'weather-rainy',
    label: 'Chuva no trajeto — piso pode escorregar',
    iconColor: '#D97706',
    textColor: '#B45309',
  };
}

function hasRepeatedTransitSequence(stages: RouteStage[]): boolean {
  for (let i = 1; i < stages.length; i += 1) {
    const prev = stages[i - 1];
    const curr = stages[i];
    const prevMode = `${prev.mode ?? ''}`.toLowerCase();
    const currMode = `${curr.mode ?? ''}`.toLowerCase();
    const bothTransit =
      (prevMode === 'bus' || prevMode === 'subway') &&
      (currMode === 'bus' || currMode === 'subway');
    if (bothTransit && prevMode === currMode) return true;
  }
  return false;
}

function stopCountLabel(stage: RouteStage): string {
  const n = stage.points?.length;
  if (n != null && n > 1) return `${n}`;
  return '--';
}

function normalizeDepartureMinutes(
  value: RouteStage['departure_minutes'],
): number | null {
  if (Array.isArray(value)) {
    const firstNumeric = value
      .map((v) => Number(v))
      .find((n) => Number.isFinite(n) && n >= 0);
    return typeof firstNumeric === 'number' ? firstNumeric : null;
  }
  const asNumber = Number(value);
  return Number.isFinite(asNumber) && asNumber >= 0 ? asNumber : null;
}

function formatClockFromNow(deltaMinutes: number): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() + Math.max(0, deltaMinutes));
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function normalizeClockText(value: string): string | null {
  const m = value.trim().match(/^(\d{1,2}):(\d{2})(?::\d{2})?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mm = Number(m[2]);
  if (!Number.isFinite(h) || !Number.isFinite(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
}

function minutesUntilClock(clock: string): number | null {
  const normalized = normalizeClockText(clock);
  if (!normalized) return null;
  const [h, m] = normalized.split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null;
  const now = new Date();
  const target = new Date();
  target.setHours(h, m, 0, 0);
  if (target.getTime() < now.getTime()) target.setDate(target.getDate() + 1);
  return Math.max(0, Math.round((target.getTime() - now.getTime()) / 60000));
}

/** Pontos para polyline (origem → pontos das etapas → destino). */
function buildPolylineCoords(route: SerializedRouteDetail): LatLng[] {
  const out: LatLng[] = [];
  const push = (lat: number, lng: number) => {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    out.push({ latitude: lat, longitude: lng });
  };

  push(route.originCoordinate.latitude, route.originCoordinate.longitude);

  for (const s of route.stages) {
    if (Array.isArray(s.points)) {
      for (const p of s.points) {
        if (typeof p?.latitude === 'number' && typeof p?.longitude === 'number') {
          push(p.latitude, p.longitude);
        }
      }
    }
  }

  push(route.destinationCoordinate.latitude, route.destinationCoordinate.longitude);

  const deduped: LatLng[] = [];
  for (const p of out) {
    const prev = deduped[deduped.length - 1];
    if (!prev || prev.latitude !== p.latitude || prev.longitude !== p.longitude) {
      deduped.push(p);
    }
  }
  return deduped;
}

/** Trechos de caminhada (laranja no mapa): cada etapa walk com ≥2 pontos. */
function buildWalkStagePolylines(route: SerializedRouteDetail): LatLng[][] {
  const polys: LatLng[][] = [];
  for (const s of route.stages) {
    if (s.mode !== 'walk' || !s.points?.length) continue;
    const pts = s.points.map((p) => ({ latitude: p.latitude, longitude: p.longitude }));
    if (pts.length >= 2) polys.push(pts);
  }
  return polys;
}

/** Polyline principal de ônibus/metrô (verde): origem + pontos de etapas não-walk + destino. */
function buildTransitPolyline(route: SerializedRouteDetail): LatLng[] {
  const out: LatLng[] = [];
  const push = (c: LatLng) => {
    const last = out[out.length - 1];
    if (!last || last.latitude !== c.latitude || last.longitude !== c.longitude) out.push(c);
  };
  push({
    latitude: route.originCoordinate.latitude,
    longitude: route.originCoordinate.longitude,
  });
  for (const s of route.stages) {
    if (s.mode === 'walk') continue;
    if (Array.isArray(s.points)) {
      for (const p of s.points) {
        if (typeof p.latitude === 'number' && typeof p.longitude === 'number') {
          push({ latitude: p.latitude, longitude: p.longitude });
        }
      }
    }
  }
  push({
    latitude: route.destinationCoordinate.latitude,
    longitude: route.destinationCoordinate.longitude,
  });
  return out;
}

/** Região para MapView a partir dos pontos da rota. */
function mapRegion(coords: LatLng[]): MapRegion | null {
  if (coords.length === 0) return null;
  let minLat = coords[0].latitude;
  let maxLat = coords[0].latitude;
  let minLng = coords[0].longitude;
  let maxLng = coords[0].longitude;
  for (const c of coords) {
    minLat = Math.min(minLat, c.latitude);
    maxLat = Math.max(maxLat, c.latitude);
    minLng = Math.min(minLng, c.longitude);
    maxLng = Math.max(maxLng, c.longitude);
  }
  const lat = (minLat + maxLat) / 2;
  const lng = (minLng + maxLng) / 2;
  const latSpan = Math.max(0.008, (maxLat - minLat) * 1.35);
  const lngSpan = Math.max(0.008, (maxLng - minLng) * 1.35);
  return {
    latitude: lat,
    longitude: lng,
    latitudeDelta: latSpan,
    longitudeDelta: lngSpan,
  };
}

function formatPriceDisplay(raw?: string): string {
  if (!raw?.trim()) return 'R$ —';
  const t = raw.trim();
  if (/^r\$/i.test(t)) return t;
  return `R$ ${t}`;
}

function parseRouteParam(raw: string | string[] | undefined): SerializedRouteDetail | null {
  if (raw == null) return null;
  const str = Array.isArray(raw) ? raw[0] : raw;
  if (!str) return null;
  try {
    const decoded = decodeURIComponent(str);
    const parsed = JSON.parse(decoded) as unknown;
    if (!parsed || typeof parsed !== 'object') return null;
    const o = parsed as Record<string, unknown>;
    const stagesRaw = o.stages;
    if (!Array.isArray(stagesRaw)) return null;
    const originCoord = o.originCoordinate as SerializedRouteDetail['originCoordinate'];
    const destCoord = o.destinationCoordinate as SerializedRouteDetail['destinationCoordinate'];
    if (
      !originCoord ||
      typeof originCoord.latitude !== 'number' ||
      typeof originCoord.longitude !== 'number' ||
      !destCoord ||
      typeof destCoord.latitude !== 'number' ||
      typeof destCoord.longitude !== 'number'
    ) {
      return null;
    }
    const stages: RouteStage[] = stagesRaw.map((s) => {
      const st = s as Record<string, unknown>;
      const mode = (st.mode === 'bus' || st.mode === 'subway' || st.mode === 'walk'
        ? st.mode
        : 'walk') as RouteStage['mode'];
      return {
        mode,
        instruction: String(st.instruction ?? ''),
        distance: String(st.distance ?? ''),
        duration: String(st.duration ?? ''),
        departure_time: st.departure_time != null ? String(st.departure_time) : undefined,
        arrival_time: st.arrival_time != null ? String(st.arrival_time) : undefined,
        departureTime: st.departureTime != null ? String(st.departureTime) : undefined,
        arrivalTime: st.arrivalTime != null ? String(st.arrivalTime) : undefined,
        departure_minutes:
          st.departure_minutes != null
            ? (st.departure_minutes as RouteStage['departure_minutes'])
            : undefined,
        transit_departure_unix:
          typeof st.transit_departure_unix === 'number'
            ? st.transit_departure_unix
            : undefined,
        accessible: st.accessible !== false,
        warning: st.warning != null ? String(st.warning) : undefined,
        slope_warning: st.slope_warning === true,
        line_code: st.line_code != null ? String(st.line_code) : undefined,
        street_view_image:
          st.street_view_image != null ? String(st.street_view_image) : undefined,
        segment_images: (() => {
          const pack = st.street_view_images;
          if (Array.isArray(pack)) {
            const u = pack
              .filter((x) => typeof x === 'string' && /^https?:\/\//i.test(String(x).trim()))
              .map((x) => String(x).trim())
              .slice(0, 3);
            if (u.length > 0) return u;
          }
          return Array.isArray(st.segment_images)
            ? (st.segment_images as unknown[])
                .filter((x) => typeof x === 'string' && /^https?:\/\//i.test(x.trim()))
                .map((x) => String(x).trim())
            : undefined;
        })(),
        points: Array.isArray(st.points)
          ? (st.points as { latitude: number; longitude: number }[]).filter(
              (p) =>
                typeof p?.latitude === 'number' &&
                typeof p?.longitude === 'number',
            )
          : undefined,
      };
    });
    const priceRaw = o.price ?? o.ticket_price ?? o.fare;
    return {
      origin: String(o.origin ?? ''),
      destination: String(o.destination ?? ''),
      totalTime: String(o.totalTime ?? o.total_time ?? ''),
      originCoordinate: originCoord,
      destinationCoordinate: destCoord,
      stages,
      price: priceRaw != null ? String(priceRaw) : undefined,
      weather:
        o.weather && typeof o.weather === 'object'
          ? {
              rain: Number((o.weather as { rain?: unknown }).rain ?? 0),
            }
          : undefined,
    };
  } catch {
    return null;
  }
}

const GUTTER = 28;

const FALLBACK_WALK_STAGE: RouteStage = {
  mode: 'walk',
  instruction: '',
  distance: '',
  duration: '',
  accessible: true,
};

export default function RouteDetailScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { voiceRead } = useAccessibilityPreferences();
  const sx = useAccessibilitySurfaces();
  const params = useLocalSearchParams<{
    route?: string | string[];
    routeList?: string | string[];
    routeIndex?: string | string[];
  }>();
  const mapRef = useRef<MapView>(null);
  const routeListParams = useMemo(() => {
    const raw = Array.isArray(params.routeList) ? params.routeList[0] : params.routeList;
    if (!raw || !raw.trim()) return [] as string[];
    const parseAsList = (value: string): string[] => {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
    };
    try {
      return parseAsList(decodeURIComponent(raw));
    } catch {
      try {
        return parseAsList(raw);
      } catch {
        return [] as string[];
      }
    }
  }, [params.routeList]);
  const initialRouteIndex = useMemo(() => {
    const raw = Array.isArray(params.routeIndex) ? params.routeIndex[0] : params.routeIndex;
    const n = Number(raw);
    return Number.isFinite(n) ? Math.max(0, Math.floor(n)) : 0;
  }, [params.routeIndex]);
  const [activeRouteIndex, setActiveRouteIndex] = useState(initialRouteIndex);
  useEffect(() => {
    setActiveRouteIndex(initialRouteIndex);
  }, [initialRouteIndex, routeListParams.length]);
  const clampedRouteIndex =
    routeListParams.length > 0
      ? Math.max(0, Math.min(activeRouteIndex, routeListParams.length - 1))
      : 0;
  const currentRouteParam = routeListParams.length > 0 ? routeListParams[clampedRouteIndex] : params.route;
  const route = useMemo(() => parseRouteParam(currentRouteParam), [currentRouteParam]);
  const rainHint = useMemo(() => routeRainHint(route), [route]);

  const polylineCoords = useMemo(() => (route ? buildPolylineCoords(route) : []), [route]);
  const transitPoly = useMemo(() => (route ? buildTransitPolyline(route) : []), [route]);
  const walkPolylines = useMemo(() => (route ? buildWalkStagePolylines(route) : []), [route]);
  const region = useMemo(() => mapRegion(polylineCoords), [polylineCoords]);

  const orderedStages = useMemo(() => {
    if (!route) return [] as RouteStage[];
    return route.stages.filter((s) => {
      const m = `${s.mode ?? ''}`.toLowerCase();
      return isWalkStageMode(s.mode) || m === 'bus' || m === 'subway';
    });
  }, [route]);

  const mapCenterForTransit = useMemo(() => {
    if (!route) return { latitude: -19.9, longitude: -43.9 };
    return {
      latitude: (route.originCoordinate.latitude + route.destinationCoordinate.latitude) / 2,
      longitude: (route.originCoordinate.longitude + route.destinationCoordinate.longitude) / 2,
    };
  }, [route]);

  const hasLiveTransitFeed = useMemo(
    () =>
      Platform.OS !== 'web' &&
      regionsWithActiveFeedAt(mapCenterForTransit.latitude, mapCenterForTransit.longitude).length > 0,
    [mapCenterForTransit.latitude, mapCenterForTransit.longitude],
  );

  const liveNav = useRouteLiveNavigation({
    route,
    polylineCoords,
    orderedStages,
  });

  const [showLiveBuses, setShowLiveBuses] = useState(false);
  useEffect(() => {
    if (!hasLiveTransitFeed) setShowLiveBuses(false);
  }, [hasLiveTransitFeed]);
  const {
    vehicles: liveVehicles,
    loading: liveVehiclesLoading,
    coverageHint: liveCoverageHint,
    lastError: liveVehiclesError,
  } = useLiveTransitVehicles({
    mapCenter: mapCenterForTransit,
    transitPolyline: transitPoly,
    enabled: showLiveBuses && hasLiveTransitFeed,
  });

  const lastFollowCamAt = useRef(0);
  useEffect(() => {
    if (!liveNav.navActive || !liveNav.userLocation || !mapRef.current) return;
    const now = Date.now();
    if (now - lastFollowCamAt.current < 5500) return;
    lastFollowCamAt.current = now;
    mapRef.current.animateCamera(
      {
        center: liveNav.userLocation,
        pitch: 0,
        heading: 0,
        zoom: 16,
      },
      { duration: 600 },
    );
  }, [liveNav.navActive, liveNav.userLocation]);

  const [isReading, setIsReading] = useState(false);
  const [isFavorite, setIsFavorite] = useState(false);
  const [showTraffic, setShowTraffic] = useState(false);
  const [expandedWalk, setExpandedWalk] = useState<Record<number, boolean>>({});
  const [expandedRide, setExpandedRide] = useState<Record<number, boolean>>({});
  const [elapsedMinutes, setElapsedMinutes] = useState(0);

  const windowH = Dimensions.get('window').height;
  const sheetCollapsedTop = windowH * 0.36;
  const sheetExpandedTop = Math.max(insets.top + 48, windowH * 0.1);
  /** Altura do footer: paddingTop 12 + linha ~52 (botão play) + paddingBottom seguro. */
  const footerBand = 12 + 52 + Math.max(insets.bottom, 12);

  const sheetTopAnim = useRef(new Animated.Value(sheetCollapsedTop)).current;
  const sheetDragStart = useRef(sheetCollapsedTop);

  const panResponder = useMemo(() => {
    const clamp = (v: number) =>
      Math.min(Math.max(v, sheetExpandedTop), sheetCollapsedTop);
    return PanResponder.create({
      onMoveShouldSetPanResponder: (_, g) =>
        Math.abs(g.dy) > 8 && Math.abs(g.dy) > Math.abs(g.dx) * 0.5,
      onPanResponderGrant: () => {
        sheetTopAnim.stopAnimation((v) => {
          sheetDragStart.current = v;
        });
      },
      onPanResponderMove: (_, g) => {
        const next = clamp(sheetDragStart.current + g.dy);
        sheetTopAnim.setValue(next);
      },
      onPanResponderRelease: (_, g) => {
        const current = clamp(sheetDragStart.current + g.dy);
        const mid = (sheetExpandedTop + sheetCollapsedTop) / 2;
        let snap: number;
        if (g.vy > 1.2) snap = sheetCollapsedTop;
        else if (g.vy < -1.2) snap = sheetExpandedTop;
        else snap = current < mid ? sheetExpandedTop : sheetCollapsedTop;
        Animated.spring(sheetTopAnim, {
          toValue: snap,
          useNativeDriver: false,
          friction: 7,
          tension: 72,
        }).start(() => {
          sheetDragStart.current = snap;
        });
      },
    });
  }, [sheetCollapsedTop, sheetExpandedTop, sheetTopAnim]);

  const readRoute = () => {
    if (!route) return;
    if (isReading) {
      Speech.stop();
      setIsReading(false);
      return;
    }
    if (!voiceRead) return;
    setIsReading(true);
    const instructions = route.stages
      .map(
        (s, i) =>
          `Etapa ${i + 1}: ${s.instruction}. Distância: ${s.distance}. Duração: ${s.duration}.`,
      )
      .join(' ');
    Speech.speak(instructions, {
      language: 'pt-BR',
      onDone: () => setIsReading(false),
      onError: () => setIsReading(false),
    });
  };

  const departureDate = useMemo(() => new Date(), [route]);
  const arrivalDate = useMemo(
    () =>
      new Date(
        departureDate.getTime() + toMinutes(stripEstimado(route?.totalTime ?? '')) * 60000,
      ),
    [departureDate, route?.totalTime],
  );
  const departureTime = formatClock(departureDate);
  const arrivalTime = formatClock(arrivalDate);

  useEffect(() => {
    if (!route || !voiceRead) return;
    AccessibilityInfo.isScreenReaderEnabled().then((enabled) => {
      if (enabled && route) readRoute();
    });
    // Leitura automática só na montagem / mudança de rota ou preferência; não incluir readRoute (evita loop).
  }, [route, voiceRead]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    setElapsedMinutes(0);
    const id = setInterval(() => {
      setElapsedMinutes((m) => m + 1);
    }, 60000);
    return () => clearInterval(id);
  }, [route]);

  useEffect(() => {
    if (!mapRef.current || polylineCoords.length < 2) return;
    const t = setTimeout(() => {
      mapRef.current?.fitToCoordinates(polylineCoords, {
        edgePadding: { top: 56, right: 20, bottom: 72, left: 20 },
        animated: true,
      });
    }, 350);
    return () => clearTimeout(t);
  }, [route, polylineCoords]);

  const handleStartNavigation = () => {
    if (Platform.OS === 'web') return;
    if (liveNav.navActive) {
      liveNav.stopNavigation();
      return;
    }
    void liveNav.startNavigation();
  };

  const fitMap = () => {
    if (mapRef.current && polylineCoords.length >= 2) {
      mapRef.current.fitToCoordinates(polylineCoords, {
        edgePadding: { top: 56, right: 20, bottom: 72, left: 20 },
        animated: true,
      });
    }
  };

  const toggleWalk = (index: number) => {
    Haptics.selectionAsync();
    setExpandedWalk((p) => ({ ...p, [index]: !p[index] }));
  };

  const toggleRide = (index: number) => {
    Haptics.selectionAsync();
    setExpandedRide((p) => ({ ...p, [index]: !p[index] }));
  };

  if (!route) {
    return (
      <SafeAreaView style={[styles.screen, sx.fillScreen]} edges={['top', 'left', 'right']}>
        <Stack.Screen options={{ headerShown: false }} />
        <View style={styles.errorBox}>
          <TouchableOpacity onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Voltar">
            <MaterialCommunityIcons name="arrow-left" size={24} color={COLORS.primary} />
          </TouchableOpacity>
          <Text style={styles.errorText}>Rota invalida ou nao informada.</Text>
        </View>
      </SafeAreaView>
    );
  }

  const initialRegion =
    region ?? {
      latitude: route.originCoordinate.latitude,
      longitude: route.originCoordinate.longitude,
      latitudeDelta: 0.045,
      longitudeDelta: 0.045,
    };

  const transitEtaMinutes = (stage: RouteStage) => {
    const unix = stage.transit_departure_unix;
    if (typeof unix === 'number' && Number.isFinite(unix)) {
      const until = Math.max(0, Math.round((unix * 1000 - Date.now()) / 60000));
      return `${Math.max(0, until - elapsedMinutes)}`;
    }
    const apiMinutes = normalizeDepartureMinutes(stage.departure_minutes);
    if (typeof apiMinutes === 'number') {
      return `${Math.max(0, apiMinutes - elapsedMinutes)}`;
    }
    const explicitDeparture = `${stage.departure_time ?? stage.departureTime ?? ''}`.trim();
    const fromClock = explicitDeparture ? minutesUntilClock(explicitDeparture) : null;
    if (typeof fromClock === 'number') {
      return `${Math.max(0, fromClock)}`;
    }
    const routeClockFallback = minutesUntilClock(departureTime);
    if (typeof routeClockFallback === 'number') {
      return `${Math.max(0, routeClockFallback)}`;
    }
    const m = toMinutes(stage.duration);
    return m > 0 ? `${Math.max(0, m - elapsedMinutes)}` : '—';
  };

  const transitLegCount = route.stages.filter(
    (s) => s.mode === 'bus' || s.mode === 'subway',
  ).length;

  const stageCount = orderedStages.length;
  const railStages = orderedStages.length > 0 ? orderedStages : [FALLBACK_WALK_STAGE];
  const showRailUnderline = hasRepeatedTransitSequence(railStages);
  const canGoBefore = routeListParams.length > 0 && clampedRouteIndex > 0;
  const canGoAfter = routeListParams.length > 0 && clampedRouteIndex < routeListParams.length - 1;

  return (
    <SafeAreaView style={[styles.screen, sx.fillScreen]} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.flex1}>
        <View style={styles.mapLayer} pointerEvents="box-none">
          <MapView
            ref={mapRef}
            style={StyleSheet.absoluteFill}
            initialRegion={initialRegion}
            showsUserLocation={liveNav.navActive}
            showsTraffic={showTraffic}
            mapType="standard"
          >
            {transitPoly.length >= 2 ? (
              <Polyline
                coordinates={transitPoly}
                strokeColor={COLORS.transitLine}
                strokeWidth={5}
              />
            ) : null}
            {walkPolylines.map((wp, i) => (
              <Polyline
                key={`walk-${i}`}
                coordinates={wp}
                strokeColor={COLORS.walkLine}
                strokeWidth={3}
              />
            ))}
            <Marker coordinate={route.originCoordinate} title="Origem" pinColor={COLORS.orangeOrigin} />
            <Marker coordinate={route.destinationCoordinate} title="Destino" pinColor={COLORS.redDest} />
            {showLiveBuses
              ? liveVehicles.map((v) => (
                  <Marker
                    key={`bus-${v.id}`}
                    coordinate={{ latitude: v.latitude, longitude: v.longitude }}
                    tracksViewChanges={false}
                    title="Ônibus"
                    description={v.routeId ? `Linha ${v.routeId}` : undefined}
                  >
                    <View style={styles.liveBusMarker}>
                      <MaterialCommunityIcons name="bus" size={14} color="#FFFFFF" />
                    </View>
                  </Marker>
                ))
              : null}
          </MapView>

          <TouchableOpacity
            style={[styles.mapFabBack, { top: Math.max(insets.top, 8) }]}
            onPress={() => router.back()}
            accessibilityLabel="Voltar"
          >
            <MaterialCommunityIcons name="arrow-left" size={22} color={COLORS.text} />
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.mapFabGps, { top: Math.max(insets.top, 8) }]}
            onPress={fitMap}
            accessibilityLabel="Centralizar mapa"
          >
            <MaterialCommunityIcons name="crosshairs-gps" size={22} color={COLORS.primary} />
          </TouchableOpacity>

          <View style={[styles.mapFloatRow, { bottom: footerBand + 12 }]}>
            <TouchableOpacity
              style={styles.pillTraffic}
              onPress={() => setShowTraffic((v) => !v)}
              activeOpacity={0.85}
            >
              <MaterialCommunityIcons name="car-outline" size={18} color="#FFFFFF" />
              <Text style={styles.pillTrafficText}>Mostrar trânsito</Text>
            </TouchableOpacity>
            {liveNav.navActive && orderedStages[liveNav.currentStageIndex] ? (
              <View style={styles.pillStageHint}>
                <Text style={styles.pillStageHintText} numberOfLines={2}>
                  Etapa {liveNav.currentStageIndex + 1}/{orderedStages.length}:{' '}
                  {orderedStages[liveNav.currentStageIndex].instruction.slice(0, 72)}
                </Text>
              </View>
            ) : null}
            {liveNav.navError ? (
              <View style={styles.pillStageHint}>
                <Text style={styles.pillStageHintErr}>{liveNav.navError}</Text>
              </View>
            ) : null}
            {showLiveBuses ? (
              <View style={styles.pillStageHint}>
                <Text style={styles.pillLiveMeta} numberOfLines={3}>
                  {liveVehiclesLoading ? 'Atualizando ônibus…' : `${liveVehicles.length} veículo(s) próximo(s) ao trajeto`}
                  {liveVehiclesError ? `\n${liveVehiclesError}` : ''}
                  {`\n${liveCoverageHint}`}
                </Text>
              </View>
            ) : null}
          </View>
        </View>

        <Animated.View
          style={[
            styles.movingStartWrap,
            {
              top: Animated.add(sheetTopAnim, -58),
            },
          ]}
          pointerEvents="box-none"
        >
          <TouchableOpacity
            style={[styles.pillStart, liveNav.navActive && styles.pillStartActive]}
            activeOpacity={0.85}
            onPress={handleStartNavigation}
            accessibilityLabel={liveNav.navActive ? 'Parar navegação do trajeto' : 'Iniciar navegação do trajeto'}
          >
            <MaterialCommunityIcons
              name={liveNav.navActive ? 'stop-circle' : 'navigation-variant'}
              size={18}
              color="#FFFFFF"
            />
            <Text style={styles.pillStartText}>{liveNav.navActive ? 'Parar' : 'Iniciar'}</Text>
          </TouchableOpacity>
        </Animated.View>

        <Animated.View
          style={[
            styles.sheet,
            sx.fillCard,
            {
              top: sheetTopAnim,
              bottom: footerBand,
            },
          ]}
        >
          <View style={styles.sheetColumn}>
            <View style={styles.sheetHandleZone} {...panResponder.panHandlers}>
              <View style={styles.sheetHandleBar} />
            </View>

            <View style={styles.sheetSummaryMain}>
              <View style={styles.summaryTop}>
                <View style={styles.summaryHeaderSide} />
                <View style={styles.summaryHeaderCenter}>
                  <View style={styles.summaryHeaderTextBlock}>
                    <Text style={styles.summaryHeaderPart}>
                      {(() => {
                        const fromTotal = toMinutes(stripEstimado(route.totalTime ?? ''));
                        if (fromTotal > 0) {
                          return fromTotal > 59 ? formatAsHoursMinutes(fromTotal) : `${fromTotal} min`;
                        }
                        const fromStages = route.stages.reduce(
                          (acc, stage) => acc + toMinutes(String(stage.duration ?? '')),
                          0,
                        );
                        if (fromStages > 0) {
                          return fromStages > 59 ? formatAsHoursMinutes(fromStages) : `${fromStages} min`;
                        }
                        return '—';
                      })()}
                    </Text>
                    <Text style={styles.summaryHeaderSep}> | </Text>
                    <Text style={styles.summaryHeaderPart}>
                      Horário de chegada: {arrivalTime}
                    </Text>
                  </View>
                </View>
                <View style={styles.summaryHeaderSide}>
                  <TouchableOpacity
                    style={styles.favStarBtn}
                    onPress={() => setIsFavorite((v) => !v)}
                    accessibilityLabel={isFavorite ? 'Remover favorito' : 'Favoritar'}
                    hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
                  >
                    <MaterialCommunityIcons
                      name={isFavorite ? 'star' : 'star-outline'}
                      size={26}
                      color={COLORS.primary}
                    />
                  </TouchableOpacity>
                </View>
              </View>

              <View style={styles.routeStagesFrame}>
                <ScrollView
                  horizontal
                  nestedScrollEnabled
                  directionalLockEnabled
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="always"
                  contentContainerStyle={styles.routeCardStagesScrollContent}
                >
                  <MaterialCommunityIcons name="walk" size={17} color="#6B7280" />
                  <Text style={styles.routeCardStageCount}>{stageCount}</Text>
                  <MaterialCommunityIcons name="chevron-right" size={13} color="#CCCCCC" />
                  <View style={styles.routeCardRailWrap}>
                    {showRailUnderline ? <View style={styles.routeCardRailUnderline} /> : null}
                    {railStages.map((stage, i, arr) => {
                      const lineLabel = extractLineCode(stage);
                      return (
                        <View key={`rail-${i}`} style={styles.routeCardRailItem}>
                          {isWalkStageMode(stage.mode) ? (
                            <MaterialCommunityIcons name="walk" size={17} color="#6B7280" />
                          ) : (
                            <View style={styles.routeCardLinePill}>
                              <View style={styles.routeCardLinePillRow}>
                                <MaterialCommunityIcons
                                  name={stage.mode === 'subway' ? 'subway-variant' : 'bus'}
                                  size={11}
                                  color="#1E1D1D"
                                />
                                <Text style={styles.routeCardLinePillText} numberOfLines={1}>
                                  {stage.line_code?.trim() ? stage.line_code.trim() : lineLabel}
                                </Text>
                              </View>
                              <View
                                style={[
                                  styles.routeCardLineStripe,
                                  { backgroundColor: getRouteCardLineStripeColor(lineLabel) },
                                ]}
                              />
                            </View>
                          )}
                          {i < arr.length - 1 ? (
                            <MaterialCommunityIcons name="chevron-right" size={13} color="#CCCCCC" />
                          ) : null}
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
              </View>
            </View>

            <View style={styles.timeWindowBar}>
              <View style={[styles.timeWindowThird, styles.timeWindowLeft]}>
                {canGoBefore ? (
                  <TouchableOpacity
                    style={styles.timeWindowNavBtn}
                    onPress={() => setActiveRouteIndex((v) => Math.max(0, v - 1))}
                    activeOpacity={0.7}
                    accessibilityLabel="Ver rota anterior"
                  >
                    <MaterialCommunityIcons name="chevron-left" size={20} color={COLORS.primary} />
                      <Text style={styles.timeWindowLabel}>Anterior</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
              <View style={[styles.timeWindowThird, styles.timeWindowCenter]}>
                <Text style={styles.timeWindowRange} numberOfLines={1}>
                  {departureTime} - {arrivalTime}
                </Text>
              </View>
              <View style={[styles.timeWindowThird, styles.timeWindowRight]}>
                {canGoAfter ? (
                  <TouchableOpacity
                    style={styles.timeWindowNavBtn}
                    onPress={() =>
                      setActiveRouteIndex((v) => Math.min(routeListParams.length - 1, v + 1))
                    }
                    activeOpacity={0.7}
                    accessibilityLabel="Ver próxima rota"
                  >
                      <Text style={styles.timeWindowLabel}>Próximo</Text>
                    <MaterialCommunityIcons name="chevron-right" size={20} color={COLORS.primary} />
                  </TouchableOpacity>
                ) : null}
              </View>
            </View>

            <ScrollView
              style={styles.sheetBodyScroll}
              contentContainerStyle={styles.sheetBodyContent}
              showsVerticalScrollIndicator={false}
              nestedScrollEnabled
            >
              <View style={styles.timelineBlock}>
            {/* Origem */}
            <View style={styles.timelineRow}>
              <View style={styles.gutter}>
                <View style={styles.originDotRing} />
                <View
                  style={[
                    styles.vline,
                    {
                      flex: 1,
                      minHeight: 10,
                      backgroundColor:
                        route.stages[0]?.mode === 'walk'
                          ? COLORS.lineGrey
                          : getTransitInstructionColor(route.stages[0]),
                    },
                  ]}
                />
              </View>
              <View style={styles.originStack}>
                <View style={styles.originHeadRow}>
                  <View style={styles.originTitleRow}>
                    <Text style={styles.titleBold} numberOfLines={2}>
                      {route.origin || 'Origem'}
                    </Text>
                  </View>
                  <View style={styles.timeColRight}>
                    <Text style={styles.timeRight}>{departureTime}</Text>
                  </View>
                </View>
                {rainHint.show ? (
                  <View
                    style={[
                      styles.originRainBanner,
                      {
                        backgroundColor: rainHint.heavy ? '#FEE2E2' : '#FFFBEB',
                        borderColor: rainHint.heavy ? '#FECACA' : '#FDE68A',
                      },
                    ]}
                    accessibilityRole="summary"
                    accessibilityLabel={rainHint.label}
                  >
                    <MaterialCommunityIcons
                      name={rainHint.icon}
                      size={17}
                      color={rainHint.iconColor}
                    />
                    <Text style={[styles.originRainBannerText, { color: rainHint.textColor }]}>
                      {rainHint.label}
                    </Text>
                  </View>
                ) : null}
              </View>
            </View>

            {route.stages.map((stage, index) => {
              const isWalk = stage.mode === 'walk';
              const isTransit = stage.mode === 'bus' || stage.mode === 'subway';
              const nextIsWalk = route.stages[index + 1]?.mode === 'walk';
              const nextStage = route.stages[index + 1];
              const prevStage = route.stages[index - 1];
              const lineCode = extractLineCode(stage);
              const accent = getRouteCardLineStripeColor(lineCode);
              const walkOpen = !!expandedWalk[index];
              const rideOpen = !!expandedRide[index];
              const punctualText = stage.accessible
                ? 'A hora de chegada é pontual'
                : 'Verifique horários e acessibilidade neste trecho';
              const punctualColor = stage.accessible ? COLORS.greenOnTime : COLORS.orangeLate;
              const walkBadge = stage.accessible === false
                ? {
                    label: 'Não acessível',
                    icon: 'wheelchair-accessibility' as const,
                    bg: '#FEE2E2',
                    fg: '#DC2626',
                  }
                : stage.slope_warning === true || !!stage.warning?.trim()
                  ? {
                      label: 'Atenção',
                      icon: 'alert' as const,
                      bg: '#FEF9C3',
                      fg: '#A16207',
                    }
                  : {
                      label: 'Acessível',
                      icon: 'wheelchair-accessibility' as const,
                      bg: '#DCFCE7',
                      fg: '#16A34A',
                    };
              const prevTransitAccent =
                prevStage && (prevStage.mode === 'bus' || prevStage.mode === 'subway')
                  ? getTransitInstructionColor(prevStage)
                  : null;
              const nextTransitAccent =
                nextStage && (nextStage.mode === 'bus' || nextStage.mode === 'subway')
                  ? getTransitInstructionColor(nextStage)
                  : null;
              const prevIsSameTransitLine =
                !!prevStage &&
                (prevStage.mode === 'bus' || prevStage.mode === 'subway') &&
                extractLineCode(prevStage) === lineCode;
              const stemUpColor =
                isTransit
                  ? accent
                  : prevTransitAccent ??
                    (index === 0 || prevStage?.mode === 'walk' ? COLORS.lineGrey : COLORS.primary);
              const lineAfterColor =
                isTransit
                  ? accent
                  : nextTransitAccent ?? (nextIsWalk ? COLORS.lineGrey : COLORS.primary);

              if (isWalk) {
                const prevTransit = route.stages[index - 1];
                const showDropoffHint =
                  !!prevTransit && (prevTransit.mode === 'bus' || prevTransit.mode === 'subway');
                const dropoffPlace = showDropoffHint
                  ? extractDropoffPlace(prevTransit.instruction)
                  : '';
                const walkImages = (
                  stage.segment_images?.length
                    ? stage.segment_images
                    : stage.street_view_image
                      ? [stage.street_view_image]
                      : []
                )
                  .filter((u, i, arr) => arr.indexOf(u) === i)
                  .slice(0, 3);
                return (
                  <View key={`s-${index}`}>
                    <View style={styles.timelineRow}>
                      <View style={styles.gutter}>
                        <View
                          style={[
                            styles.vline,
                            { backgroundColor: COLORS.lineGrey, flex: 1, minHeight: 10 },
                          ]}
                        />
                        <View style={styles.walkIconOnLine}>
                          <MaterialCommunityIcons name="walk" size={20} color="#6B7280" />
                        </View>
                        <View
                          style={[
                            styles.vline,
                            { backgroundColor: COLORS.lineGrey, flex: 1, minHeight: 10 },
                          ]}
                        />
                      </View>
                      <View style={[styles.blockMain, styles.walkBlockMain]}>
                        <View style={styles.stageDivider} />
                        {showDropoffHint ? (
                          <Text style={styles.dropoffHintText}>
                            Desça na estação {dropoffPlace}
                          </Text>
                        ) : null}
                        <TouchableOpacity
                          style={styles.expandHead}
                          onPress={() => toggleWalk(index)}
                          activeOpacity={0.7}
                        >
                          <View style={styles.walkHeadInfo}>
                            <Text style={styles.walkText}>
                              Caminhe {stage.distance || '—'} | {stage.duration || '—'}
                            </Text>
                            <View style={[styles.walkBadge, { backgroundColor: walkBadge.bg }]}>
                              <MaterialCommunityIcons name={walkBadge.icon} size={12} color={walkBadge.fg} />
                              <Text style={[styles.walkBadgeText, { color: walkBadge.fg }]}>
                                {walkBadge.label}
                              </Text>
                            </View>
                          </View>
                          <MaterialCommunityIcons
                            name={walkOpen ? 'chevron-up' : 'chevron-down'}
                            size={20}
                            color={COLORS.primary}
                          />
                        </TouchableOpacity>
                        {walkImages.length > 0 ? (
                          <ScrollView
                            horizontal
                            showsHorizontalScrollIndicator={false}
                            style={styles.photoScroll}
                          >
                            {walkImages.map((uri, photoIdx) => (
                              <ExpoImage
                                key={`walk-photo-${index}-${photoIdx}`}
                                source={{ uri }}
                                style={styles.photoThumb}
                                contentFit="cover"
                              />
                            ))}
                          </ScrollView>
                        ) : null}
                        {!stage.accessible && stage.warning ? (
                          <View style={styles.warningCard}>
                            <MaterialCommunityIcons name="alert" size={18} color="#CA8A04" />
                            <Text style={styles.warningText}>{stage.warning}</Text>
                          </View>
                        ) : null}
                      </View>
                    </View>
                  </View>
                );
              }

              if (isTransit) {
                const destName =
                  stage.instruction.split(/\s+/).slice(1).join(' ').trim() || stage.instruction;
                const boardingPlace = extractBoardingPlace(stage.instruction);
                const minutesToBus = transitEtaMinutes(stage);
                const minutesNumeric = Number(minutesToBus);
                const etaLabel = Number.isFinite(minutesNumeric)
                  ? formatAsHoursMinutes(Math.max(0, minutesNumeric))
                  : '—';
                const explicitDeparture =
                  normalizeClockText(`${stage.departure_time ?? stage.departureTime ?? ''}`) ?? null;
                const busPassClock = Number.isFinite(minutesNumeric)
                  ? formatClockFromNow(minutesNumeric)
                  : (explicitDeparture ?? departureTime);

                return (
                  <View key={`s-${index}`}>
                    <View style={styles.timelineRow}>
                      <View style={styles.gutter}>
                        <View
                          style={[
                            styles.vline,
                            prevIsSameTransitLine ? styles.vlineTransit : null,
                            {
                              backgroundColor: prevIsSameTransitLine
                                ? accent
                                : prevTransitAccent ?? COLORS.lineGrey,
                              minHeight: 8,
                            },
                          ]}
                        />
                        <View style={[styles.transitCircle, { backgroundColor: accent }]}>
                          <MaterialCommunityIcons
                            name={stage.mode === 'subway' ? 'subway-variant' : 'bus'}
                            size={18}
                            color="#FFFFFF"
                          />
                        </View>
                        <View
                          style={[
                            styles.vline,
                            styles.vlineTransit,
                            { backgroundColor: lineAfterColor, flex: 1, minHeight: 10 },
                          ]}
                        />
                      </View>
                      <View style={styles.blockMain}>
                        <View style={styles.stageDivider} />
                        <View style={styles.transitTop}>
                          <View style={styles.transitTitleBlock}>
                            <View style={styles.transitHeaderRow}>
                              <View style={styles.routeCardLinePill}>
                                <View style={styles.routeCardLinePillRow}>
                                  <MaterialCommunityIcons
                                    name={stage.mode === 'subway' ? 'subway-variant' : 'bus'}
                                    size={11}
                                    color="#1E1D1D"
                                  />
                                  <Text style={styles.routeCardLinePillText} numberOfLines={1}>
                                    {lineCode}
                                  </Text>
                                </View>
                                <View
                                  style={[
                                    styles.routeCardLineStripe,
                                    { backgroundColor: getRouteCardLineStripeColor(lineCode) },
                                  ]}
                                />
                              </View>
                              <Text style={styles.transitAddressText} numberOfLines={2}>
                                {boardingPlace}
                                {stage.accessible ? ' ' : ''}
                                {stage.accessible ? (
                                  <MaterialCommunityIcons
                                    name="wheelchair-accessibility"
                                    size={16}
                                    color={COLORS.greenOnTime}
                                  />
                                ) : null}
                              </Text>
                            </View>
                            {transitLegCount > 1 ? (
                              <Text style={[styles.punctual, { color: punctualColor }]}>
                                {punctualText}
                              </Text>
                            ) : null}
                          </View>
                          <View style={styles.transitRightCol}>
                            {stage.street_view_image ? (
                              <ExpoImage
                                source={{ uri: stage.street_view_image }}
                                style={styles.thumb56}
                                contentFit="cover"
                              />
                            ) : (
                              <View style={[styles.thumb56, styles.thumbPlaceholder]} />
                            )}
                            <View style={styles.etaBoxUnderThumb}>
                              <MaterialCommunityIcons name="wifi" size={14} color={COLORS.greenOnTime} />
                              <Text style={styles.etaMin}>{etaLabel}</Text>
                            </View>
                            <Text style={styles.busPassText}>
                              {busPassClock}
                            </Text>
                          </View>
                        </View>

                        <View style={styles.badgeRow}>
                          {hasLiveTransitFeed ? (
                            <TouchableOpacity
                              style={[styles.transitActionBtn, showLiveBuses && styles.transitActionBtnOn]}
                              activeOpacity={0.85}
                              onPress={() => setShowLiveBuses((v) => !v)}
                            >
                              <MaterialCommunityIcons
                                name="bus-clock"
                                size={16}
                                color="#FFFFFF"
                              />
                              <Text style={styles.transitActionText}>
                                {showLiveBuses ? 'Ocultar ônibus ao vivo' : 'Localização em tempo real'}
                              </Text>
                            </TouchableOpacity>
                          ) : null}
                          <TouchableOpacity
                            style={styles.transitActionBtn}
                            activeOpacity={0.85}
                            onPress={() => {
                              void (async () => {
                                const ok = await ensureJourneyNotificationPermission();
                                Alert.alert(
                                  'Notificações da viagem',
                                  ok
                                    ? 'Quando você tocar em Iniciar, avisamos a cada nova etapa do trajeto.'
                                    : 'Sem permissão, só verá os avisos na tela. Ative nas configurações do sistema.',
                                );
                              })();
                            }}
                          >
                            <MaterialCommunityIcons
                              name="bell-ring-outline"
                              size={16}
                              color="#FFFFFF"
                            />
                            <Text style={styles.transitActionText}>Notificações por etapa</Text>
                          </TouchableOpacity>
                        </View>

                      </View>
                    </View>
                  </View>
                );
              }

              return null;
            })}

            <View style={styles.timelineRow}>
              <View style={styles.gutter}>
                <View
                  style={[
                    styles.vline,
                    {
                      flex: 1,
                      minHeight: 10,
                      backgroundColor:
                        route.stages[route.stages.length - 1]?.mode === 'walk'
                          ? COLORS.lineGrey
                          : getTransitInstructionColor(route.stages[route.stages.length - 1]),
                    },
                  ]}
                />
                <View style={styles.destDot} />
              </View>
              <View style={styles.rowMain}>
                <View style={styles.originTitleRow}>
                  <Text style={styles.titleBold} numberOfLines={3}>
                    {route.destination}
                  </Text>
                </View>
                <View style={styles.timeColRight}>
                  <Text style={styles.timeRight}>{arrivalTime}</Text>
                  <Text style={styles.timeSubRight}>Chegada</Text>
                </View>
              </View>
            </View>
              </View>
            </ScrollView>
          </View>
        </Animated.View>

        <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 12) }]}>
          <TouchableOpacity
            style={styles.btnPlay}
            onPress={() => readRoute()}
            accessibilityLabel={isReading ? 'Parar leitura da rota' : 'Ouvir rota em voz alta'}
          >
            <MaterialCommunityIcons name={isReading ? 'stop' : 'play'} size={26} color="#FFFFFF" />
          </TouchableOpacity>
          {hasLiveTransitFeed ? (
            <TouchableOpacity
              style={[styles.btnPill, showLiveBuses && styles.btnPillActive]}
              activeOpacity={0.88}
              onPress={() => setShowLiveBuses((v) => !v)}
              accessibilityLabel={
                showLiveBuses ? 'Desligar ônibus em tempo real no mapa' : 'Mostrar ônibus em tempo real no mapa'
              }
            >
              <MaterialCommunityIcons name="bus-clock" size={18} color="#FFFFFF" />
              <Text style={[styles.btnPillText, styles.btnPillTextSmall]} numberOfLines={2}>
                {showLiveBuses ? 'Ônibus ao vivo ligado' : 'Localização em tempo real'}
              </Text>
            </TouchableOpacity>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  flex1: { flex: 1 },
  screen: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  mapLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#E5E7EB',
  },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: -4 },
    elevation: 14,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
  },
  sheetColumn: {
    flex: 1,
  },
  sheetHandleZone: {
    paddingVertical: 8,
    alignItems: 'center',
  },
  sheetHandleBar: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D1D5DB',
  },
  sheetSummaryMain: {
    paddingHorizontal: 20,
    paddingBottom: 4,
  },
  sheetBodyScroll: {
    flex: 1,
  },
  sheetBodyContent: {
    paddingBottom: 16,
  },
  routeStagesFrame: {
    marginTop: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    backgroundColor: '#FAFAFA',
    paddingVertical: 8,
    paddingHorizontal: 10,
  },
  originStack: {
    flex: 1,
    minWidth: 0,
    paddingLeft: 8,
    paddingBottom: 16,
  },
  originHeadRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
  },
  originTitleRow: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
    minWidth: 0,
  },
  originRainBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 6,
    marginTop: 6,
    marginRight: 4,
    paddingVertical: 8,
    paddingHorizontal: 8,
    maxWidth: '88%',
    borderRadius: 10,
    borderWidth: StyleSheet.hairlineWidth,
  },
  originRainBannerText: {
    flex: 1,
    flexShrink: 1,
    fontSize: 12,
    fontWeight: '600',
    lineHeight: 17,
  },
  routeCardStagesScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingRight: 12,
    paddingVertical: 2,
  },
  timeWindowBar: {
    alignSelf: 'stretch',
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
    marginTop: 12,
    paddingVertical: 12,
    paddingHorizontal: 16,
    backgroundColor: '#F3F4F6',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
  },
  timeWindowThird: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  timeWindowNavBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  timeWindowLeft: {
    justifyContent: 'flex-start',
    gap: 4,
  },
  timeWindowCenter: {
    justifyContent: 'center',
  },
  timeWindowRight: {
    justifyContent: 'flex-end',
    gap: 4,
  },
  timeWindowLabel: {
    color: COLORS.primary,
    fontSize: 13,
    fontWeight: '700',
  },
  timeWindowRange: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: '800',
    textAlign: 'center',
  },
  routeCardStageCount: {
    color: '#374151',
    fontSize: 18,
    fontWeight: '700',
  },
  stageDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
    marginBottom: 10,
  },
  routeCardRailWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    position: 'relative',
    paddingBottom: 6,
  },
  routeCardRailUnderline: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2,
    backgroundColor: '#1E88E5',
    borderRadius: 2,
  },
  routeCardRailItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  routeCardLinePill: {
    position: 'relative',
    backgroundColor: '#FFFFFF',
    borderRadius: 5,
    paddingHorizontal: 8,
    paddingVertical: 5,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  routeCardLinePillRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  routeCardLinePillText: {
    color: '#1E1D1D',
    fontSize: 10.5,
    fontWeight: '700',
    maxWidth: 120,
  },
  routeCardLineStripe: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 2.5,
  },
  mapFabBack: {
    position: 'absolute',
    left: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  mapFabGps: {
    position: 'absolute',
    right: 12,
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    elevation: 4,
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
  },
  mapFloatRow: {
    position: 'absolute',
    left: 12,
    right: 12,
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    alignItems: 'center',
  },
  movingStartWrap: {
    position: 'absolute',
    right: 12,
    zIndex: 15,
  },
  pillTraffic: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: COLORS.purpleTip,
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    elevation: 3,
  },
  pillTrafficText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  pillStart: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#22c55e',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 999,
    elevation: 3,
  },
  pillStartText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  pillStartActive: {
    backgroundColor: '#B91C1C',
  },
  pillStageHint: {
    maxWidth: '100%',
    backgroundColor: 'rgba(255,255,255,0.96)',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: '#E5E7EB',
    elevation: 2,
  },
  pillStageHintText: {
    fontSize: 12,
    fontWeight: '600',
    color: COLORS.text,
  },
  pillStageHintErr: {
    fontSize: 12,
    fontWeight: '600',
    color: '#B91C1C',
  },
  pillLiveMeta: {
    fontSize: 11,
    fontWeight: '500',
    color: COLORS.textMuted,
  },
  liveBusMarker: {
    backgroundColor: COLORS.primary,
    borderRadius: 14,
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  summaryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  summaryHeaderSide: {
    width: 40,
    flexShrink: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryHeaderCenter: {
    flex: 1,
    minWidth: 0,
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  summaryHeaderTextBlock: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    justifyContent: 'center',
  },
  summaryHeaderPart: {
    fontSize: 17,
    fontWeight: '800',
    color: COLORS.text,
  },
  summaryHeaderSep: {
    fontSize: 17,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  favStarBtn: {
    flexShrink: 0,
    justifyContent: 'center',
    alignItems: 'center',
  },
  timelineBlock: {
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  timelineRow: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  gutter: {
    width: GUTTER,
    alignItems: 'center',
  },
  vline: {
    width: 2,
    alignSelf: 'center',
    borderRadius: 1,
  },
  vlineTransit: {
    width: 6,
    borderRadius: 3,
  },
  originDotRing: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 3,
    borderColor: COLORS.orangeOrigin,
    backgroundColor: '#FFFFFF',
  },
  destDot: {
    width: 14,
    height: 14,
    borderRadius: 7,
    backgroundColor: COLORS.redDest,
  },
  walkIconOnLine: {
    marginVertical: 0,
    backgroundColor: 'transparent',
    padding: 2,
  },
  transitCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: COLORS.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  rowMain: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 8,
    paddingBottom: 16,
    paddingLeft: 8,
  },
  timeColRight: {
    alignItems: 'flex-end',
    flexShrink: 0,
    minWidth: 52,
    marginLeft: 6,
  },
  timeRight: {
    fontSize: 17,
    fontWeight: '900',
    color: COLORS.text,
  },
  timeSubRight: {
    marginTop: 2,
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  blockMain: {
    flex: 1,
    paddingLeft: 8,
    paddingBottom: 20,
  },
  walkBlockMain: {
    minHeight: 84,
  },
  titleBold: {
    flex: 1,
    fontSize: 16,
    fontWeight: '700',
    color: COLORS.text,
    lineHeight: 21,
  },
  expandHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  walkHeadInfo: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
  },
  walkText: {
    marginTop: 8,
    fontSize: 15,
    fontWeight: '600',
    color: '#4B5563',
  },
  dropoffHintText: {
    marginBottom: 6,
    fontSize: 13,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  walkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    borderRadius: 10,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  walkBadgeText: {
    fontSize: 11,
    fontWeight: '700',
  },
  photoScroll: {
    marginTop: 10,
  },
  photoThumb: {
    width: 120,
    height: 80,
    borderRadius: 8,
    backgroundColor: '#E5E7EB',
    marginRight: 8,
  },
  warningCard: {
    flexDirection: 'row',
    gap: 10,
    alignItems: 'flex-start',
    backgroundColor: COLORS.yellowCard,
    borderWidth: 1,
    borderColor: COLORS.yellowBorder,
    borderRadius: 10,
    padding: 12,
    marginTop: 10,
  },
  warningText: {
    flex: 1,
    fontSize: 13,
    color: COLORS.yellowText,
    lineHeight: 18,
  },
  transitTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    gap: 12,
    marginBottom: 10,
  },
  transitRightCol: {
    alignItems: 'flex-end',
    gap: 6,
  },
  transitTitleBlock: {
    flex: 1,
    minWidth: 0,
  },
  transitHeaderRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
  },
  transitAddressText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '400',
    color: COLORS.text,
    lineHeight: 21,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 6,
  },
  codeGrey: {
    marginTop: 4,
    fontSize: 12,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  thumb56: {
    width: 56,
    height: 56,
    borderRadius: 8,
    backgroundColor: '#E5E7EB',
  },
  thumbPlaceholder: {},
  badgeRow: {
    flexDirection: 'column',
    alignItems: 'stretch',
    gap: 8,
    marginTop: 10,
  },
  transitActionBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: COLORS.primary,
    borderRadius: 999,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  transitActionBtnOn: {
    backgroundColor: '#15803D',
  },
  transitActionText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  lineBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: COLORS.badgeBg,
    paddingHorizontal: 8,
    paddingVertical: 5,
    borderRadius: 6,
    overflow: 'hidden',
    position: 'relative',
  },
  lineBadgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '800',
  },
  lineBadgeStripe: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
  },
  destPreview: {
    flex: 1,
    minWidth: 80,
    fontSize: 13,
    color: COLORS.textMuted,
    fontWeight: '500',
  },
  etaBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  etaBoxUnderThumb: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    backgroundColor: '#DCFCE7',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 8,
  },
  busPassText: {
    fontSize: 11,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  etaMin: {
    fontSize: 15,
    fontWeight: '800',
    color: COLORS.greenOnTime,
  },
  etaMinSuffix: {
    fontSize: 11,
    fontWeight: '700',
    color: COLORS.greenOnTime,
  },
  etaClock: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.text,
  },
  punctual: {
    marginTop: 8,
    fontSize: 12,
    fontWeight: '600',
  },
  rideSummary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 14,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
  },
  rideSummaryText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '600',
    color: COLORS.textMuted,
  },
  rideSummaryRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  priceTag: {
    fontSize: 13,
    fontWeight: '700',
    color: COLORS.primary,
  },
  rideExpand: {
    backgroundColor: '#F9FAFB',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  rideExpandText: {
    fontSize: 13,
    color: COLORS.textMuted,
    lineHeight: 18,
  },
  footer: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 20,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 16,
    paddingTop: 12,
    backgroundColor: '#FFFFFF',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
  },
  btnPlay: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#22c55e',
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnPill: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minHeight: 48,
    borderRadius: 24,
    backgroundColor: COLORS.primary,
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  btnPillActive: {
    backgroundColor: '#15803D',
  },
  btnPillText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
    textAlign: 'center',
    flexShrink: 1,
  },
  btnPillTextSmall: {
    fontSize: 11,
    lineHeight: 14,
  },
  errorBox: {
    flex: 1,
    padding: 16,
    gap: 16,
  },
  errorText: {
    color: COLORS.textMuted,
    fontSize: 15,
  },
});
