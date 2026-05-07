import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState, type ComponentProps } from 'react';
import { ACTIVE_MOCK_WEATHER } from '../mocks';
import {
  fetchDiverseRoutes,
  type DiverseRoutesPayload,
} from '../services/fetch-diverse-routes';
import { getUserInfo } from '../services/token.service';
import * as Location from 'expo-location';
import {
  ActivityIndicator,
  Alert,
  Keyboard,
  Linking,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import Svg, { Circle, Line, Path } from 'react-native-svg';
import { ScaledText as Text } from '@/components/ScaledText';
import { ScaledTextInput as TextInput } from '@/components/ScaledTextInput';
import { useAccessibilitySurfaces } from '@/contexts/accessibility-preferences';
import { A11Y_HIT_SLOP } from '@/constants/accessibility';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  addMinutesToClock,
  formatClockFromNow,
  formatClockNow,
  formatUnixToLocalClock,
  isClock,
  isWalkStageMode,
  routeAttentionReason,
  minutesUntilClock,
  normalizeDepartureMinutes,
  normalizeStageMode,
  routeCompanionAudience,
  routeDurationMinutes,
  routeIncidentCount,
  routeMatchesCompanionTab,
  routeSignature,
  routeTransportFamily,
  stageDurationMinutes,
  stageNeedsAttention,
  type CompanionTab,
} from '../utils/route-results-logic';
import { isRouteWithinMobilityCoverage } from '../utils/mobility-coverage';

type Stage = {
  mode?: string;
  distance?: string;
  duration?: string | number;
  line_code?: string;
  instruction?: string;
  stop_name?: string;
  departure_time?: string;
  arrival_time?: string;
  departureTime?: string;
  arrivalTime?: string;
  departure_minutes?: number | string | Array<number | string>;
  /** Segundos desde epoch — partida real do trecho (Google Transit). */
  transit_departure_unix?: number;
  street_view_image?: string;
  /** Até 3 URLs — só caminhada (backend). */
  street_view_images?: string[];
  points?: { latitude: number; longitude: number }[];
  accessible?: boolean;
  warning?: string;
  slope_warning?: boolean;
};

type RouteItem = {
  total_duration?: string;
  totalDuration?: string;
  totalTime?: string;
  total_distance?: string;
  accessible?: boolean;
  slope_warning?: boolean;
  warning?: string;
  accompanied_warning?: string;
  accompanied?: string;
  companion_mode?: string;
  recommended_for?: string;
  profile?: string;
  uber_deeplink?: string;
  departTime?: string;
  arriveTime?: string;
  weather?: {
    rain?: number;
  } | null;
  stages?: Stage[];
  /** Definido pela API conforme a busca (sozinho vs acompanhado). */
  search_profile?: 'alone' | 'companied';
  /** 0–100 da API: maior = mais acessível. */
  accessibility_score?: number;
};

type TimeFilterOption = {
  key:
    | 'leave_now'
    | 'set_departure_time'
    | 'set_arrival_time'
    | 'last_departures_today';
  label: string;
  timeValue?: string;
};

type TimeFilterKey = TimeFilterOption['key'];
type RoutePreferenceKey = 'less_transfers' | 'less_walking';

const TIME_FILTER_OPTIONS: TimeFilterOption[] = [
  { key: 'leave_now', label: 'Sair agora (próximos 30 min)' },
  { key: 'set_departure_time', label: 'Definir horário de saída', timeValue: '08:00' },
  { key: 'set_arrival_time', label: 'Definir horário de chegada desejado', timeValue: '09:00' },
  { key: 'last_departures_today', label: 'Últimas partidas (a partir das 21h)' },
];

type MciName = ComponentProps<typeof MaterialCommunityIcons>['name'];

const ROUTE_PREFERENCE_OPTIONS: Array<{ key: RoutePreferenceKey; label: string; icon: MciName }> = [
  { key: 'less_transfers', label: 'Menos trocas', icon: 'swap-horizontal' },
  { key: 'less_walking', label: 'Caminhar menos', icon: 'walk' },
];

function buildRoutePreferences(
  preferLessTransfers: boolean,
  preferLessWalking: boolean,
): string[] | undefined {
  const out: string[] = [];
  if (preferLessTransfers) out.push('less_transfers');
  if (preferLessWalking) out.push('less_walking');
  return out.length > 0 ? out : undefined;
}

const TIME_FILTER_LABELS: Record<TimeFilterKey, string> = {
  leave_now: 'Sair agora',
  set_departure_time: 'Definir horário de saída',
  set_arrival_time: 'Definir horário de chegada desejado',
  last_departures_today: 'Últimas partidas para hoje',
};

function makeTimeFilterOption(key: TimeFilterKey, timeValue?: string): TimeFilterOption {
  const baseLabel = TIME_FILTER_LABELS[key];
  if (
    timeValue &&
    (key === 'set_departure_time' || key === 'set_arrival_time')
  ) {
    return { key, label: `${baseLabel} (${timeValue})`, timeValue };
  }
  return { key, label: baseLabel, timeValue };
}

function splitTimeToDigits(timeValue?: string): string[] {
  const match = `${timeValue ?? ''}`.match(/^(\d{2}):(\d{2})$/);
  if (!match) return ['', '', '', ''];
  return [match[1][0], match[1][1], match[2][0], match[2][1]];
}

/** Até 4 dígitos para um único campo (preenche HH:MM em sequência). */
function splitTimeToRawDigits(timeValue?: string): string {
  return splitTimeToDigits(timeValue).join('').replace(/\D/g, '').slice(0, 4);
}

const uberDeepLink = 'uber://?action=setPickup';

function collectStageDetailImages(stage: Stage): string[] {
  const raw = stage as unknown as Record<string, unknown>;
  const urls: string[] = [];
  const pushIfUrl = (value: unknown) => {
    if (typeof value !== 'string') return;
    const v = value.trim();
    if (/^https?:\/\//i.test(v)) urls.push(v);
  };

  const walkPack = raw.street_view_images;
  if (Array.isArray(walkPack)) {
    for (const item of walkPack) pushIfUrl(item);
  }
  pushIfUrl(stage.street_view_image);
  pushIfUrl(raw.image_url);
  pushIfUrl(raw.imageUrl);
  pushIfUrl(raw.photo_url);
  pushIfUrl(raw.photoUrl);
  pushIfUrl(raw.preview_image);

  const listKeys = [
    'street_view_images',
    'slope_images',
    'slope_photos',
    'warning_images',
    'images',
    'photos',
  ] as const;
  for (const key of listKeys) {
    const arr = raw[key];
    if (!Array.isArray(arr)) continue;
    for (const item of arr) pushIfUrl(item);
  }

  return urls.filter((u, i, a) => a.indexOf(u) === i);
}

/** Demo: chuva no mock quando o destino menciona Ibituruna (ex.: Shopping Ibituruna, Av. José Corrêa…). */
function normalizeDestMatch(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

function shouldPreviewRainForDestination(destination: string): boolean {
  return normalizeDestMatch(destination).includes('ibituruna');
}

/** Pré-visualização de chuva no cenário de demo Ibituruna — só ativa com EXPO_PUBLIC_DEMO_MODE. */
const DEMO_MODE_ENABLED = ['1', 'true', 'yes'].includes(
  `${process.env.EXPO_PUBLIC_DEMO_MODE ?? ''}`.toLowerCase(),
);

function withPreviewWeatherIfNeeded(
  routesList: RouteItem[],
  destination: string,
): RouteItem[] {
  if (!DEMO_MODE_ENABLED) return routesList;
  if (!shouldPreviewRainForDestination(destination)) return routesList;
  const rain = ACTIVE_MOCK_WEATHER.rain;
  return routesList.map((r) => ({
    ...r,
    weather: { rain },
  }));
}

function routeCardRainChip(route: RouteItem): {
  icon: 'weather-rainy' | 'weather-pouring';
  bg: string;
  fg: string;
  borderColor: string;
  label: string;
} | null {
  const w = route.weather;
  if (!w || typeof w !== 'object') return null;
  const rain = Number((w as { rain?: unknown }).rain ?? 0);
  if (!Number.isFinite(rain) || rain <= 0) return null;
  if (rain > 5) {
    return {
      icon: 'weather-pouring',
      bg: '#FEE2E2',
      fg: '#B91C1C',
      borderColor: '#FECACA',
      label: 'Chuva forte',
    };
  }
  return {
    icon: 'weather-rainy',
    bg: '#FEF3C7',
    fg: '#B45309',
    borderColor: '#FDE68A',
    label: 'Chuva',
  };
}

const getLineColor = (code: string): string => {
  const colors = [
    '#E53935', '#FB8C00', '#43A047', '#1E88E5',
    '#8E24AA', '#00897B', '#F4511E', '#D81B60',
    '#6D4C41', '#546E7A', '#039BE5', '#7CB342',
    '#FFB300', '#3949AB', '#00ACC1', '#E91E63',
  ];
  const hash = code.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return colors[hash % colors.length];
};

type DetailLatLng = { latitude: number; longitude: number };

function normalizeStageModeForDetail(mode?: string): 'walk' | 'bus' | 'subway' {
  const m = `${mode ?? ''}`.toLowerCase();
  if (m === 'walk' || m === 'walking' || m === 'foot') return 'walk';
  if (m.includes('metro') || m.includes('subway') || m === 'rail') return 'subway';
  return 'bus';
}

function serializeRouteDetail(
  route: RouteItem,
  ctx: {
    origin: string;
    destination: string;
    originCoordinate: DetailLatLng;
    destinationCoordinate: DetailLatLng;
  },
): string {
  const topLevelDuration = `${route.total_duration ?? route.totalDuration ?? route.totalTime ?? ''}`.trim();
  const durationFromStages = (() => {
    const toMinutes = (raw: unknown): number => {
      const s = `${raw ?? ''}`;
      const h = s.match(/(\d+)\s*h/i);
      const m = s.match(/(\d+)\s*min/i);
      const fromLabel = (h ? Number(h[1]) * 60 : 0) + (m ? Number(m[1]) : 0);
      if (fromLabel > 0) return fromLabel;
      const onlyNumber = s.match(/\d+/)?.[0];
      return onlyNumber ? Number(onlyNumber) : 0;
    };
    const sum = (route.stages ?? []).reduce((acc, st) => acc + toMinutes(st.duration), 0);
    return sum > 0 ? `${sum} min` : '';
  })();
  const detailTotalTime = topLevelDuration || durationFromStages;

  const extractStageFallbackPoints = (stage: Stage): DetailLatLng[] => {
    const raw = stage as unknown as Record<string, unknown>;
    const toLatLng = (v: unknown): DetailLatLng | null => {
      if (!v || typeof v !== 'object') return null;
      const o = v as Record<string, unknown>;
      const lat = typeof o.latitude === 'number' ? o.latitude : typeof o.lat === 'number' ? o.lat : Number(o.lat);
      const lng =
        typeof o.longitude === 'number' ? o.longitude : typeof o.lng === 'number' ? o.lng : Number(o.lng);
      if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
      return { latitude: lat, longitude: lng };
    };

    // Tentativas comuns (Google / OTP / mapeamentos do backend)
    const start =
      toLatLng(raw.start_location) ??
      toLatLng(raw.startLocation) ??
      toLatLng(raw.location) ??
      toLatLng(raw.from) ??
      null;
    const end =
      toLatLng(raw.end_location) ??
      toLatLng(raw.endLocation) ??
      toLatLng(raw.to) ??
      toLatLng(raw.destination_location) ??
      toLatLng(raw.destinationLocation) ??
      null;

    if (start && end && (start.latitude !== end.latitude || start.longitude !== end.longitude)) {
      return [start, end];
    }
    if (start) return [start];
    if (end) return [end];
    return [];
  };

  const stages = (route.stages ?? []).map((s) => {
    const pts = Array.isArray(s.points)
      ? (s.points as { latitude?: number; longitude?: number }[])
          .filter(
            (p) =>
              typeof p?.latitude === 'number' &&
              typeof p?.longitude === 'number' &&
              Number.isFinite(p.latitude) &&
              Number.isFinite(p.longitude),
          )
          .map((p) => ({ latitude: p.latitude as number, longitude: p.longitude as number }))
      : [];
    const fallbackPts = pts.length > 0 ? [] : extractStageFallbackPoints(s);
    return {
      mode: normalizeStageModeForDetail(s.mode),
      instruction: String(s.instruction ?? ''),
      distance: String(s.distance ?? ''),
      duration: String(s.duration ?? ''),
      departure_time: s.departure_time,
      arrival_time: s.arrival_time,
      departureTime: s.departureTime,
      arrivalTime: s.arrivalTime,
      departure_minutes: s.departure_minutes,
      transit_departure_unix:
        typeof s.transit_departure_unix === 'number' ? s.transit_departure_unix : undefined,
      accessible: s.accessible !== false,
      warning: s.warning != null && String(s.warning).trim() ? String(s.warning) : undefined,
      street_view_image: s.street_view_image,
      slope_warning: s.slope_warning === true,
      segment_images: collectStageDetailImages(s),
      line_code: s.line_code != null && String(s.line_code).trim() ? String(s.line_code) : undefined,
      points: pts.length > 0 ? pts : fallbackPts.length > 0 ? fallbackPts : undefined,
    };
  });

  return JSON.stringify({
    origin: ctx.origin,
    destination: ctx.destination,
    totalTime: detailTotalTime,
    originCoordinate: ctx.originCoordinate,
    destinationCoordinate: ctx.destinationCoordinate,
    weather:
      route.weather && typeof route.weather === 'object'
        ? {
            rain: Number((route.weather as { rain?: unknown }).rain ?? 0),
          }
        : undefined,
    stages,
  });
}

/** Coordenadas de extremidade a partir dos pontos da rota (quando GPS/param não estiverem no estado). */
function detailCoordinateFallbacks(route: RouteItem): {
  origin: DetailLatLng;
  destination: DetailLatLng;
} {
  const stages = route.stages ?? [];
  const first = stages.find((s) => Array.isArray(s.points) && s.points.length > 0)?.points?.[0];
  const lastStage = [...stages].reverse().find((s) => Array.isArray(s.points) && s.points.length > 0);
  const last = lastStage?.points?.[(lastStage.points?.length ?? 1) - 1];
  return {
    origin:
      first &&
      typeof first.latitude === 'number' &&
      typeof first.longitude === 'number'
        ? { latitude: first.latitude, longitude: first.longitude }
        : { latitude: -16.7, longitude: -43.86 },
    destination:
      last &&
      typeof last.latitude === 'number' &&
      typeof last.longitude === 'number'
        ? { latitude: last.latitude, longitude: last.longitude }
        : { latitude: -16.72, longitude: -43.87 },
  };
}

/** Acima disso, não mostramos “em X h” — só o horário (evita “em 17 h” confuso). */
const MAX_RELATIVE_WAIT_DISPLAY_MINUTES = 180;

type SearchField = 'origin' | 'destination' | 'waypoint';
type PlaceSuggestion = { description: string; placeId: string; mainText?: string };
type PackagedRoutesByTab = { alone: RouteItem[]; companied: RouteItem[] };

function toFiniteLatLng(lat: unknown, lng: unknown): { lat: number; lng: number } | null {
  const la = typeof lat === 'number' ? lat : Number(lat);
  const lo = typeof lng === 'number' ? lng : Number(lng);
  if (!Number.isFinite(la) || !Number.isFinite(lo)) return null;
  return { lat: la, lng: lo };
}

const JOURNEY_RAIL_W = 14;

/** Um único SVG: ponto + trilho + seta (sem três Views separadas). */
function JourneyTimelineConnector({ height }: { height: number }) {
  const mid = JOURNEY_RAIL_W / 2;
  const dotR = 3.5;
  const dotCY = dotR + 2;
  const lineTop = dotCY + dotR + 1.5;
  const arrowBaseY = height - 6;
  const arrowTipY = height - 2;
  if (height < lineTop + 10) {
    return (
      <Svg width={JOURNEY_RAIL_W} height={height} viewBox={`0 0 ${JOURNEY_RAIL_W} ${height}`}>
        <Circle cx={mid} cy={Math.max(dotR + 1, height * 0.22)} r={Math.min(dotR, height * 0.14)} fill="#9CA3AF" />
      </Svg>
    );
  }
  return (
    <Svg width={JOURNEY_RAIL_W} height={height} viewBox={`0 0 ${JOURNEY_RAIL_W} ${height}`}>
      <Circle cx={mid} cy={dotCY} r={dotR} fill="#9CA3AF" />
      <Line
        x1={mid}
        y1={lineTop}
        x2={mid}
        y2={arrowBaseY}
        stroke="#D1D5DB"
        strokeWidth={2}
        strokeLinecap="round"
      />
      <Path d={`M ${mid - 3} ${arrowBaseY} L ${mid + 3} ${arrowBaseY} L ${mid} ${arrowTipY} Z`} fill="#9CA3AF" />
    </Svg>
  );
}

function JourneyTimelineRail() {
  const [h, setH] = useState(30);
  return (
    <View
      style={{ width: JOURNEY_RAIL_W, alignSelf: 'stretch' }}
      onLayout={(e) => {
        const next = Math.round(e.nativeEvent.layout.height);
        if (next > 0) setH((prev) => (prev === next ? prev : next));
      }}
    >
      <JourneyTimelineConnector height={h} />
    </View>
  );
}

function formatWaitTime(totalMinutes: number): string {
  if (totalMinutes <= 59) return `${totalMinutes} min`;
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  if (minutes === 0) return `${hours}h`;
  return `${hours}h ${minutes.toString().padStart(2, '0')}min`;
}

function extractPlaceName(stage: Stage): string {
  const normalizePlace = (value: string) =>
    value
      .replace(/->|→/g, ' ')
      .replace(/^\d+\s*/g, '')
      .replace(/\b(linha|line)\b/gi, '')
      .replace(/\s+/g, ' ')
      .trim();

  const stop = `${stage.stop_name ?? ''}`.trim();
  if (stop) {
    const shortStop = stop.split(',')[0]?.split(' - ')[0]?.trim() ?? stop;
    return normalizePlace(shortStop);
  }

  const instruction = `${stage.instruction ?? ''}`.trim();
  if (!instruction) return '';

  const parenthesized = instruction.match(/\(([^)]+)\)/)?.[1] ?? '';
  const source = parenthesized || instruction;
  const cleaned = source.replace(/\s+/g, ' ').trim();
  const routeLike = cleaned
    .split(/via/i)[0]
    .split(/->|→/)[0]
    .split(',')[0]
    .split(' - ')[0]
    .trim();
  const matchAte = routeLike.match(/\bat[eé]\s+(.+)$/i)?.[1]?.trim();
  const matchPara = routeLike.match(/\bpara\s+(.+)$/i)?.[1]?.trim();
  const candidate = matchAte || matchPara || routeLike;
  const firstPlace = candidate.split('/')[0]?.trim() ?? candidate;
  return normalizePlace(firstPlace);
}

export default function RouteResultsScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const sx = useAccessibilitySurfaces();
  const params = useLocalSearchParams<{
    origin?: string | string[];
    destination?: string | string[];
    routes?: string | string[];
    originCoordinate?: string | string[];
    destinationCoordinate?: string | string[];
  }>();
  const originFromParams = useMemo(
    () => (Array.isArray(params.origin) ? params.origin[0] : params.origin) ?? '',
    [params.origin],
  );
  const destinationFromParams = useMemo(
    () => (Array.isArray(params.destination) ? params.destination[0] : params.destination) ?? '',
    [params.destination],
  );

  const originCoordParam = useMemo(() => {
    try {
      const raw = Array.isArray(params.originCoordinate) ? params.originCoordinate[0] : params.originCoordinate;
      if (!raw || typeof raw !== 'string') return null;
      const o = JSON.parse(raw) as { latitude?: unknown; longitude?: unknown };
      return toFiniteLatLng(o.latitude, o.longitude);
    } catch {
      return null;
    }
  }, [params.originCoordinate]);

  const destCoordParam = useMemo(() => {
    try {
      const raw = Array.isArray(params.destinationCoordinate)
        ? params.destinationCoordinate[0]
        : params.destinationCoordinate;
      if (!raw || typeof raw !== 'string') return null;
      const o = JSON.parse(raw) as { latitude?: unknown; longitude?: unknown };
      return toFiniteLatLng(o.latitude, o.longitude);
    } catch {
      return null;
    }
  }, [params.destinationCoordinate]);

  type LatLng = { lat: number; lng: number };
  const [headerOrigin, setHeaderOrigin] = useState(originFromParams);
  const [headerDestination, setHeaderDestination] = useState(destinationFromParams);
  /** Uma parada opcional entre origem e destino (`null` = nenhuma). */
  const [middleStop, setMiddleStop] = useState<string | null>(null);
  const [activeOriginCoord, setActiveOriginCoord] = useState<LatLng | null>(null);
  const [activeDestCoord, setActiveDestCoord] = useState<LatLng | null>(null);
  const [activeCompanionTab, setActiveCompanionTab] = useState<CompanionTab>('alone');
  const [fetchedSplit, setFetchedSplit] = useState<DiverseRoutesPayload | null>(null);
  const [activeSearchField, setActiveSearchField] = useState<SearchField | null>(null);
  const [placeSuggestions, setPlaceSuggestions] = useState<PlaceSuggestion[]>([]);
  /** Rótulos curtos (ex.: main_text) enviados ao histórico; endereços completos ficam em headerOrigin / headerDestination. */
  const [historyOriginTitle, setHistoryOriginTitle] = useState<string | undefined>(undefined);
  const [historyDestinationTitle, setHistoryDestinationTitle] = useState<string | undefined>(undefined);
  const [selectedTimeFilter, setSelectedTimeFilter] = useState<TimeFilterOption>(TIME_FILTER_OPTIONS[0]);
  const [showTimeFilterList, setShowTimeFilterList] = useState(false);
  const [forcedServerResults, setForcedServerResults] = useState(false);
  const [initialRoutesLoading, setInitialRoutesLoading] = useState(false);
  /** Busca disparada pelo header (filtros, “Buscar rotas”): esconde cards até a API responder. */
  const [suggestedRoutesRefetchLoading, setSuggestedRoutesRefetchLoading] = useState(false);
  const [preferLessTransfers, setPreferLessTransfers] = useState(false);
  const [preferLessWalking, setPreferLessWalking] = useState(false);
  const [showManualTimeModal, setShowManualTimeModal] = useState(false);
  const [pendingTimeFilterKey, setPendingTimeFilterKey] = useState<
    'set_departure_time' | 'set_arrival_time' | null
  >(null);
  /** Somente dígitos (máx. 4); um campo invisível preenche os quadrados em sequência. */
  const [manualTimeRaw, setManualTimeRaw] = useState('');
  const manualTimeInputRef = useRef<TextInput>(null);
  /**
   * Evita que o fetch automático (ao abrir / mudar destino na URL) sobrescreva resultados
   * depois que o usuário já pediu outra busca via filtros ou “Buscar rotas” (endereços do header).
   */
  const autoInitialRoutesFetchEpochRef = useRef(0);

  /** Coordenadas efetivas para API (URL + estado; GPS pode preencher depois do primeiro paint). */
  const mergedOriginCoordForApi = useMemo(() => {
    const lat = activeOriginCoord?.lat ?? originCoordParam?.lat;
    const lng = activeOriginCoord?.lng ?? originCoordParam?.lng;
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
    return { lat, lng };
  }, [activeOriginCoord?.lat, activeOriginCoord?.lng, originCoordParam?.lat, originCoordParam?.lng]);

  const mergedDestCoordForApi = useMemo(() => {
    const lat = activeDestCoord?.lat ?? destCoordParam?.lat;
    const lng = activeDestCoord?.lng ?? destCoordParam?.lng;
    if (lat == null || lng == null || !Number.isFinite(lat) || !Number.isFinite(lng)) return undefined;
    return { lat, lng };
  }, [activeDestCoord?.lat, activeDestCoord?.lng, destCoordParam?.lat, destCoordParam?.lng]);

  const hasPackagedRoutes = useMemo(() => {
    const rawParam = Array.isArray(params.routes) ? params.routes[0] : params.routes;
    return !!(rawParam && String(rawParam).trim());
  }, [params.routes]);

  useEffect(() => {
    setHeaderOrigin(originFromParams);
    setHeaderDestination(destinationFromParams);
    setMiddleStop(null);
    setActiveOriginCoord(originCoordParam);
    setActiveDestCoord(destCoordParam);
    setFetchedSplit(null);
    setShowTimeFilterList(false);
    setForcedServerResults(false);
    setInitialRoutesLoading(false);
    setSuggestedRoutesRefetchLoading(false);
    setSelectedTimeFilter(TIME_FILTER_OPTIONS[0]);
    setPreferLessTransfers(false);
    setPreferLessWalking(false);
    setShowManualTimeModal(false);
    setPendingTimeFilterKey(null);
    setManualTimeRaw('');
    setHistoryOriginTitle(undefined);
    setHistoryDestinationTitle(undefined);
  }, [originFromParams, destinationFromParams, originCoordParam, destCoordParam]);

  /** Sem `routes` na URL (ex.: home / estações): busca na API ao abrir. */
  useEffect(() => {
    const rawParam = Array.isArray(params.routes) ? params.routes[0] : params.routes;
    const rawText = rawParam ? String(rawParam).trim() : '';
    // Se a tela veio com `routes` via params, mas está vazio (caso comum quando a busca
    // anterior falhou / mudou backend), fazemos fetch mesmo assim para não "travar" a UI.
    if (rawText) {
      try {
        const parsed = JSON.parse(decodeURIComponent(rawText)) as unknown;
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          const obj = parsed as Record<string, unknown>;
          const alone = Array.isArray(obj.alone) ? obj.alone : null;
          const companied = Array.isArray(obj.companied) ? obj.companied : null;
          if (alone && companied && (alone.length > 0 || companied.length > 0)) {
            setInitialRoutesLoading(false);
            return;
          }
        } else if (Array.isArray(parsed) && parsed.length > 0) {
          setInitialRoutesLoading(false);
          return;
        }
      } catch {
        // ignora — se não der pra parsear, seguimos com fetch como fallback
      }
    }

    const dest = destinationFromParams.trim();
    if (!dest) return;

    if (
      mergedOriginCoordForApi &&
      mergedDestCoordForApi &&
      !isRouteWithinMobilityCoverage(mergedOriginCoordForApi, mergedDestCoordForApi)
    ) {
      router.replace('/out-of-coverage');
      return;
    }

    const epoch = ++autoInitialRoutesFetchEpochRef.current;
    let cancelled = false;
    (async () => {
      setInitialRoutesLoading(true);
      try {
        const { userId } = await getUserInfo();
        if (typeof userId !== 'number' || Number.isNaN(userId) || cancelled) {
          if (!cancelled && epoch === autoInitialRoutesFetchEpochRef.current) {
            setFetchedSplit({ alone: [], companied: [] });
            setForcedServerResults(true);
          }
          return;
        }
        const originQuery = originFromParams.trim() || 'Local atual';
        /** Só para carga inicial / mudança de rota na URL — filtros usam `fetchRoutesForHeader`. */
        const defaultTime = TIME_FILTER_OPTIONS[0];
        const routePrefs = buildRoutePreferences(false, false);
        const payload = await fetchDiverseRoutes(
          originQuery,
          dest,
          userId,
          undefined,
          defaultTime.key,
          defaultTime.timeValue,
          undefined,
          {
            originAddress: originQuery,
            destinationAddress: dest,
            ...(mergedOriginCoordForApi ? { originCoord: mergedOriginCoordForApi } : {}),
            ...(mergedDestCoordForApi ? { destinationCoord: mergedDestCoordForApi } : {}),
            ...(routePrefs ? { routePreferences: routePrefs } : {}),
          },
        );
        if (!cancelled && epoch === autoInitialRoutesFetchEpochRef.current) {
          setFetchedSplit(payload);
          setMiddleStop(null);
          setForcedServerResults(true);
        }
      } catch (error) {
        if (!cancelled && epoch === autoInitialRoutesFetchEpochRef.current) {
          setFetchedSplit({ alone: [], companied: [] });
          setForcedServerResults(true);
        }
        if ((error as { name?: string } | null)?.name === 'RoutesUnauthorizedError') {
          if (!cancelled) router.replace('/login');
        }
      } finally {
        if (!cancelled) setInitialRoutesLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [
    destinationFromParams,
    originFromParams,
    params.routes,
    mergedOriginCoordForApi,
    mergedDestCoordForApi,
    router,
  ]);

  useEffect(() => {
    if (originFromParams.trim()) return;
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const pos = await Location.getCurrentPositionAsync({});
        if (cancelled) return;
        setActiveOriginCoord({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        const rev = await Location.reverseGeocodeAsync({
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
        });
        if (cancelled) return;
        const first = rev[0];
        const label = first
          ? [first.street, first.district, first.city].filter(Boolean).join(', ')
          : '';
        if (label.trim()) {
          setHeaderOrigin(label.trim());
          setHistoryOriginTitle(undefined);
        }
      } catch {
        // mantém vazio se geolocalização falhar
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [originFromParams]);

  useEffect(() => {
    if (!activeSearchField) {
      setPlaceSuggestions([]);
      return;
    }
    const key = process.env.EXPO_PUBLIC_GOOGLE_API_KEY?.trim();
    const query = (
      activeSearchField === 'origin'
        ? headerOrigin
        : activeSearchField === 'waypoint'
          ? middleStop ?? ''
          : headerDestination
    ).trim();
    if (!key || query.length < 3) {
      setPlaceSuggestions([]);
      return;
    }
    let cancelled = false;
    const timeoutId = setTimeout(async () => {
      try {
        const biasCoord =
          activeSearchField === 'waypoint' && activeOriginCoord && activeDestCoord
            ? {
                lat: (activeOriginCoord.lat + activeDestCoord.lat) / 2,
                lng: (activeOriginCoord.lng + activeDestCoord.lng) / 2,
              }
            : activeSearchField === 'origin'
              ? activeOriginCoord ?? activeDestCoord
              : activeDestCoord ?? activeOriginCoord;
        let url =
          'https://maps.googleapis.com/maps/api/place/autocomplete/json' +
          `?input=${encodeURIComponent(query)}` +
          '&language=pt-BR' +
          '&types=geocode' +
          '&region=br';
        if (biasCoord) {
          url += `&location=${biasCoord.lat},${biasCoord.lng}&radius=100000`;
        }
        url += `&key=${encodeURIComponent(key)}`;
        const res = await fetch(url);
        const json = (await res.json()) as {
          predictions?: {
            description?: string;
            place_id?: string;
            structured_formatting?: { main_text?: string };
          }[];
        };
        if (cancelled) return;
        const next = (json.predictions ?? [])
          .map((p) => {
            const description = String(p.description ?? '').trim();
            const mainRaw = String(p.structured_formatting?.main_text ?? '').trim();
            const mainText = mainRaw && mainRaw !== description ? mainRaw : undefined;
            return {
              description,
              placeId: String(p.place_id ?? '').trim(),
              ...(mainText ? { mainText } : {}),
            };
          })
          .filter((p) => p.description && p.placeId)
          .slice(0, 3);
        setPlaceSuggestions(next);
      } catch {
        if (!cancelled) setPlaceSuggestions([]);
      }
    }, 280);
    return () => {
      cancelled = true;
      clearTimeout(timeoutId);
    };
  }, [
    activeSearchField,
    headerOrigin,
    middleStop,
    headerDestination,
    activeOriginCoord,
    activeDestCoord,
  ]);

  const handleSwapLocations = () => {
    setHeaderOrigin(headerDestination);
    setHeaderDestination(headerOrigin);
    setActiveOriginCoord(activeDestCoord);
    setActiveDestCoord(activeOriginCoord);
    const ot = historyOriginTitle;
    setHistoryOriginTitle(historyDestinationTitle);
    setHistoryDestinationTitle(ot);
  };

  const handleAddWaypoint = () => {
    if (middleStop === null) setMiddleStop('');
  };

  const handleRemoveMiddleStop = () => {
    setMiddleStop(null);
  };

  const fetchRoutesForHeader = async (opts?: {
    timeOption?: TimeFilterOption;
    preferLessTransfers?: boolean;
    preferLessWalking?: boolean;
  }) => {
    const nextTimeOption = opts?.timeOption ?? selectedTimeFilter;
    const nextLessTransfers = opts?.preferLessTransfers ?? preferLessTransfers;
    const nextLessWalking = opts?.preferLessWalking ?? preferLessWalking;
    const routePrefs = buildRoutePreferences(nextLessTransfers, nextLessWalking);
    const destinationQuery = headerDestination.trim();
    if (!destinationQuery) return;
    if (
      mergedOriginCoordForApi &&
      mergedDestCoordForApi &&
      !isRouteWithinMobilityCoverage(mergedOriginCoordForApi, mergedDestCoordForApi)
    ) {
      router.replace('/out-of-coverage');
      return;
    }
    Keyboard.dismiss();
    setShowTimeFilterList(false);
    setActiveSearchField(null);
    setPlaceSuggestions([]);
    autoInitialRoutesFetchEpochRef.current += 1;
    setSuggestedRoutesRefetchLoading(true);
    try {
      const { userId } = await getUserInfo();
      if (typeof userId !== 'number' || Number.isNaN(userId)) {
        setFetchedSplit({ alone: [], companied: [] });
        setForcedServerResults(true);
        return;
      }
      const originQuery = headerOrigin.trim() || 'Local atual';
      const historyExtras = {
        ...(historyOriginTitle?.trim() ? { originTitle: historyOriginTitle.trim() } : {}),
        ...(historyDestinationTitle?.trim()
          ? { destinationTitle: historyDestinationTitle.trim() }
          : {}),
        originAddress: originQuery,
        destinationAddress: destinationQuery,
      };
      const payload = await fetchDiverseRoutes(
        originQuery,
        destinationQuery,
        userId,
        undefined,
        nextTimeOption.key,
        nextTimeOption.timeValue,
        undefined,
        {
          ...historyExtras,
          ...(mergedOriginCoordForApi ? { originCoord: mergedOriginCoordForApi } : {}),
          ...(mergedDestCoordForApi ? { destinationCoord: mergedDestCoordForApi } : {}),
          ...(routePrefs ? { routePreferences: routePrefs } : {}),
        },
      );
      setFetchedSplit(payload);
      setForcedServerResults(true);
      setMiddleStop(null);
    } catch (error) {
      setFetchedSplit({ alone: [], companied: [] });
      setForcedServerResults(true);
      if ((error as { name?: string } | null)?.name === 'RoutesUnauthorizedError') {
        router.replace('/login');
      }
    } finally {
      setSuggestedRoutesRefetchLoading(false);
    }
  };

  const openManualTimeModal = useCallback(
    (filterKey: 'set_departure_time' | 'set_arrival_time') => {
      setPendingTimeFilterKey(filterKey);
      setManualTimeRaw(splitTimeToRawDigits(selectedTimeFilter.timeValue));
      setShowManualTimeModal(true);
    },
    [selectedTimeFilter.timeValue],
  );

  useEffect(() => {
    if (!showManualTimeModal) return;
    const id = setTimeout(() => manualTimeInputRef.current?.focus(), 280);
    return () => clearTimeout(id);
  }, [showManualTimeModal]);

  const handleManualTimeCancel = useCallback(() => {
    setShowManualTimeModal(false);
    setPendingTimeFilterKey(null);
    setManualTimeRaw('');
  }, []);

  const handleManualTimeConfirm = useCallback(() => {
    if (!pendingTimeFilterKey) return;
    const raw = manualTimeRaw.replace(/\D/g, '');
    if (raw.length !== 4) {
      Alert.alert('Horário inválido', 'Digite 4 números (hora e minuto), por exemplo 0830.');
      return;
    }
    const hour = Number(raw.slice(0, 2));
    const minute = Number(raw.slice(2, 4));
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      Alert.alert('Horário inválido', 'Informe um horário válido entre 00:00 e 23:59.');
      return;
    }
    const hhmm = `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
    const nextFilter = makeTimeFilterOption(pendingTimeFilterKey, hhmm);
    setSelectedTimeFilter(nextFilter);
    setShowManualTimeModal(false);
    setPendingTimeFilterKey(null);
    setManualTimeRaw('');
    fetchRoutesForHeader({ timeOption: nextFilter });
  }, [fetchRoutesForHeader, manualTimeRaw, pendingTimeFilterKey]);

  const packagedRoutesByTab = useMemo<PackagedRoutesByTab | null>(() => {
    const rawParam = Array.isArray(params.routes) ? params.routes[0] : params.routes;
    if (!rawParam || !rawParam.trim()) return null;
    try {
      const parsed = JSON.parse(decodeURIComponent(rawParam)) as unknown;
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
      const obj = parsed as Record<string, unknown>;
      const alone = Array.isArray(obj.alone) ? (obj.alone as RouteItem[]) : null;
      const companied = Array.isArray(obj.companied) ? (obj.companied as RouteItem[]) : null;
      if (!alone || !companied) return null;
      return { alone, companied };
    } catch {
      return null;
    }
  }, [params.routes]);

  const routes = useMemo(() => {
    if (forcedServerResults && fetchedSplit) {
      return (activeCompanionTab === 'alone' ? fetchedSplit.alone : fetchedSplit.companied) as RouteItem[];
    }
    if (packagedRoutesByTab) {
      return activeCompanionTab === 'alone'
        ? packagedRoutesByTab.alone
        : packagedRoutesByTab.companied;
    }
    const rawParam = Array.isArray(params.routes) ? params.routes[0] : params.routes;
    if (rawParam && rawParam.trim()) {
      try {
        return JSON.parse(decodeURIComponent(rawParam)) ?? [];
      } catch {
        // ignora JSON inválido em routes
      }
    }
    if (fetchedSplit) {
      return (activeCompanionTab === 'alone' ? fetchedSplit.alone : fetchedSplit.companied) as RouteItem[];
    }
    return [];
  }, [forcedServerResults, packagedRoutesByTab, activeCompanionTab, params.routes, fetchedSplit]);

  const showRouteResults = hasPackagedRoutes || fetchedSplit !== null || forcedServerResults;

  const filteredRoutes = useMemo(() => {
    const calmRoutes = (routes as RouteItem[]).filter((route) => {
      if (!routeMatchesCompanionTab(route, activeCompanionTab)) return false;
      const audience = routeCompanionAudience(route);
      if (!audience || audience === 'both') return true;
      return audience === activeCompanionTab;
    });
    const bySignature = new Map<string, RouteItem>();
    for (const route of calmRoutes) {
      const key = routeSignature(route);
      if (!bySignature.has(key)) bySignature.set(key, route);
    }
    const sorted = Array.from(bySignature.values()).sort(
      (a, b) => routeDurationMinutes(a) - routeDurationMinutes(b),
    );
    return withPreviewWeatherIfNeeded(sorted, headerDestination);
  }, [routes, activeCompanionTab, headerDestination]);
  const hasTypedAddress = headerDestination.trim().length > 0;

  const mostAccessibleRoute = useMemo(() => {
    const accessibleRoutes = filteredRoutes.filter((route) => {
      const allStagesAccessible = (route.stages ?? []).every((stage: any) => stage?.accessible !== false);
      return route.accessible === true && allStagesAccessible;
    });
    if (accessibleRoutes.length === 0) return null;
    return [...accessibleRoutes].sort(
      (a, b) => routeDurationMinutes(a) - routeDurationMinutes(b),
    )[0];
  }, [filteredRoutes]);
  const displayedRoutes = useMemo(() => {
    const featuredSig = mostAccessibleRoute ? routeSignature(mostAccessibleRoute) : null;
    const list = featuredSig
      ? filteredRoutes.filter((r) => routeSignature(r) !== featuredSig)
      : [...filteredRoutes];
    // Regra do produto: dentro da aba, ordenar por duração total (menor → maior),
    // mantendo o card "rota mais acessível" separado no topo.
    return [...list].sort((a, b) => routeDurationMinutes(a) - routeDurationMinutes(b));
  }, [filteredRoutes, mostAccessibleRoute]);

  const cardRoutes = useMemo(
    () => (mostAccessibleRoute ? [mostAccessibleRoute, ...displayedRoutes] : displayedRoutes),
    [mostAccessibleRoute, displayedRoutes],
  );

  const openRouteDetail = useCallback(
    (route: RouteItem, cardIndex: number) => {
      const fb = detailCoordinateFallbacks(route);
      const originCoordinate =
        activeOriginCoord != null
          ? { latitude: activeOriginCoord.lat, longitude: activeOriginCoord.lng }
          : fb.origin;
      const destinationCoordinate =
        activeDestCoord != null
          ? { latitude: activeDestCoord.lat, longitude: activeDestCoord.lng }
          : fb.destination;
      const detailRoutes = cardRoutes.map((cardRoute) =>
        serializeRouteDetail(cardRoute, {
          origin: headerOrigin,
          destination: headerDestination,
          originCoordinate:
            activeOriginCoord != null
              ? { latitude: activeOriginCoord.lat, longitude: activeOriginCoord.lng }
              : detailCoordinateFallbacks(cardRoute).origin,
          destinationCoordinate:
            activeDestCoord != null
              ? { latitude: activeDestCoord.lat, longitude: activeDestCoord.lng }
              : detailCoordinateFallbacks(cardRoute).destination,
        }),
      );
      router.push({
        pathname: '/route-detail',
        params: {
          route: serializeRouteDetail(route, {
            origin: headerOrigin,
            destination: headerDestination,
            originCoordinate,
            destinationCoordinate,
          }),
          routeIndex: String(cardIndex),
          routeList: encodeURIComponent(JSON.stringify(detailRoutes)),
        },
      });
    },
    [router, headerOrigin, headerDestination, activeOriginCoord, activeDestCoord, cardRoutes],
  );

  const formatDurationLabel = (route: RouteItem) => {
    const mins = routeDurationMinutes(route);
    if (mins > 0) return `${mins} min`;
    const raw = `${route.total_duration ?? route.totalDuration ?? route.totalTime ?? ''}`.trim();
    const cleaned = raw
      .replace(/estimado/gi, '')
      .replace(/\s+/g, ' ')
      .trim();
    if (!cleaned) return '-- min';
    if (/\bmin\b/i.test(cleaned) || /\bh\b/i.test(cleaned)) return cleaned;
    const onlyNumber = cleaned.match(/\d+/)?.[0];
    return onlyNumber ? `${onlyNumber} min` : `${cleaned} min`;
  };

  const formatTripDurationDisplay = (totalMinutes: number, route: RouteItem) => {
    const mins = totalMinutes > 0 ? totalMinutes : routeDurationMinutes(route);
    if (mins > 59) return formatWaitTime(mins);
    if (mins > 0) return `${mins} min`;
    return formatDurationLabel(route);
  };

  const renderRouteCard = (route: RouteItem, key: string, featured = false, cardIndex = 0) => {
    const orderedStages = (route.stages ?? []).filter((s) => {
      const m = `${s.mode ?? ''}`.toLowerCase();
      return isWalkStageMode(s.mode) || m === 'bus' || m === 'subway';
    });
    const firstTransitStage = orderedStages.find((s) => s.mode === 'bus' || s.mode === 'subway');
    const lastTransitStage = [...orderedStages].reverse().find((s) => s.mode === 'bus' || s.mode === 'subway');
    const routeMinutesFromLabel = routeDurationMinutes(route);
    const stageMinutesSum = orderedStages.reduce((acc, s) => acc + stageDurationMinutes(s), 0);
    const totalMinutes = routeMinutesFromLabel > 0 ? routeMinutesFromLabel : stageMinutesSum;
    const firstTransitDepartureMinutes = normalizeDepartureMinutes(firstTransitStage?.departure_minutes);
    const transitDepUnix = firstTransitStage?.transit_departure_unix;
    const rawDepartureTime =
      firstTransitStage?.departure_time ??
      firstTransitStage?.departureTime ??
      route.departTime;
    const departureTime = isClock(rawDepartureTime)
      ? rawDepartureTime!.trim()
      : typeof transitDepUnix === 'number' && Number.isFinite(transitDepUnix)
        ? formatUnixToLocalClock(transitDepUnix)
        : typeof firstTransitDepartureMinutes === 'number'
          ? formatClockFromNow(firstTransitDepartureMinutes)
          : formatClockNow();
    const rawArrivalTime = lastTransitStage?.arrival_time ?? lastTransitStage?.arrivalTime ?? route.arriveTime;
    const arrivalTime = isClock(rawArrivalTime)
      ? rawArrivalTime!.trim()
      : addMinutesToClock(departureTime, totalMinutes > 0 ? totalMinutes : 0);
    const stageCount = orderedStages.length;
    const hasInaccessibleStage = orderedStages.some((s) => s.accessible === false);
    const hasAttentionSegments =
      route.slope_warning === true ||
      !!route.warning ||
      !!route.accompanied_warning ||
      orderedStages.some((s) => stageNeedsAttention(s));
    const accessibilityStatus:
      | { label: string; bg: string; fg: string }
      | null =
      hasInaccessibleStage || route.accessible === false
        ? { label: 'Não acessível', bg: '#FEE2E2', fg: '#DC2626' }
        : hasAttentionSegments
          ? null
          : { label: 'Acessível', bg: '#DCFCE7', fg: '#16A34A' };
    const rainChip = routeCardRainChip(route);
    const summaryPlaces = orderedStages
      .map((s) => extractPlaceName(s))
      .filter(Boolean)
      .filter((name, idx, arr) => idx === 0 || name.toLowerCase() !== arr[idx - 1]?.toLowerCase())
      // todas as etapas (não truncar) — UX: o Text abaixo pode quebrar em 2 linhas
      ;

    const odSummary =
      summaryPlaces.length >= 2
        ? summaryPlaces.join(' › ')
        : summaryPlaces.length === 1
          ? summaryPlaces[0]
          : [headerOrigin.trim(), headerDestination.trim()].filter(Boolean).join(' › ') || 'Trajeto direto';

    const departureInfoLine =
      firstTransitStage
        ? (() => {
            const explicitDeparture = firstTransitStage.departure_time ?? firstTransitStage.departureTime;
            const departureClock = isClock(explicitDeparture)
              ? explicitDeparture!.trim()
              : departureTime;
            const minutesNorm = normalizeDepartureMinutes(firstTransitStage.departure_minutes);
            let minutesLeft: number;
            if (typeof transitDepUnix === 'number' && Number.isFinite(transitDepUnix)) {
              minutesLeft = Math.max(
                0,
                Math.round((transitDepUnix * 1000 - Date.now()) / 60000),
              );
            } else if (typeof minutesNorm === 'number') {
              minutesLeft = minutesNorm;
            } else {
              minutesLeft = minutesUntilClock(departureClock);
            }
            if (minutesLeft <= MAX_RELATIVE_WAIT_DISPLAY_MINUTES) {
              return `O ônibus sai às ${departureClock} · em ${formatWaitTime(minutesLeft)}`;
            }
            if (selectedTimeFilter.key === 'leave_now') {
              return `Próxima partida · ${departureClock}`;
            }
            return `Partida prevista · ${departureClock}`;
          })()
        : `O ônibus sai às ${departureTime}`;

    const stageRow = (orderedStages.length > 0 ? orderedStages : [{ mode: 'walk' }]) as Stage[];
    const allStagesAreWalk =
      stageRow.length > 0 && stageRow.every((stage) => isWalkStageMode(stage.mode));
    const durationTopValue = (() => {
      const asLabel = (totalM: number): string => {
        const safe = Math.max(0, Math.floor(totalM));
        if (safe < 60) return `${safe} min`;
        const h = Math.floor(safe / 60);
        const m = safe % 60;
        return `${h}h ${String(m).padStart(2, '0')}min`;
      };
      if (totalMinutes > 0) return asLabel(totalMinutes);
      const fallback = formatDurationLabel(route);
      const digits = fallback.match(/\d+/)?.[0];
      const asMinutes = digits ? Number(digits) : NaN;
      if (Number.isFinite(asMinutes)) return asLabel(asMinutes);
      return '--';
    })();

    return (
      <View
        key={key}
        style={[
          styles.routeCard,
          {
            padding: 0,
            overflow: 'hidden',
            borderRadius: 16,
            backgroundColor: '#FFFFFF',
            borderWidth: featured ? 1.5 : 0.5,
            borderColor: featured ? '#0057A8' : '#E0E0E0',
            marginBottom: 10,
          },
        ]}
      >
        {featured && (
          <View
            style={{
              backgroundColor: '#0057A8',
              paddingHorizontal: 14,
              paddingVertical: 7,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 6,
            }}
          >
            <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.6)' }} />
            <Text style={{ color: '#FFFFFF', fontSize: 11, fontWeight: '500' }}>Rota mais acessível</Text>
          </View>
        )}

        <View style={{ padding: 14 }}>
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              marginBottom: 10,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 2 }}>
              <Text style={{ color: '#1E1D1D', fontSize: 32, fontWeight: '700', lineHeight: 36 }}>
                {durationTopValue}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end' }}>
              <Text style={{ color: '#1E1D1D', fontSize: 13, fontWeight: '500' }}>{departureTime}</Text>
              <Text style={{ color: '#999999', fontSize: 11, marginTop: 2 }}>chegada {arrivalTime}</Text>
            </View>
          </View>

          <View
            style={{
              backgroundColor: '#F5F7FA',
              borderRadius: 10,
              paddingHorizontal: 10,
              paddingVertical: 8,
              flexDirection: 'row',
              alignItems: 'center',
              flexWrap: 'wrap',
              gap: 4,
              marginBottom: 12,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
              <MaterialCommunityIcons name="walk" size={15} color="#666666" />
              <Text style={{ fontSize: 11, color: '#000000', fontWeight: '800' }}>{stageCount}</Text>
            </View>
            {stageRow.length > 0 ? <Text style={{ color: '#CCCCCC', fontSize: 12 }}>›</Text> : null}
            {allStagesAreWalk ? (
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                <MaterialCommunityIcons name="walk" size={15} color="#666666" />
              </View>
            ) : (
              stageRow.map((stage, i, arr) => (
                <Fragment key={`${key}-s-${i}`}>
                  {isWalkStageMode(stage.mode) ? (
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                      <MaterialCommunityIcons name="walk" size={15} color="#666666" />
                      {stage.duration ? (
                        <Text style={{ fontSize: 11, color: '#666666' }}>{stage.duration}</Text>
                      ) : null}
                    </View>
                  ) : (
                    <View
                      style={{
                        backgroundColor: '#FFFFFF',
                        borderRadius: 6,
                        paddingHorizontal: 8,
                        paddingTop: 3,
                        paddingBottom: 5,
                        overflow: 'hidden',
                        borderWidth: 1,
                        borderColor: '#E5E7EB',
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                        <MaterialCommunityIcons
                          name={stage.mode === 'subway' ? 'subway-variant' : 'bus'}
                          size={11}
                          color="#1E1D1D"
                        />
                        <Text style={{ color: '#1E1D1D', fontSize: 11, fontWeight: '700' }}>
                          {stage.line_code ?? stage.mode}
                        </Text>
                      </View>
                      <View
                        style={{
                          position: 'absolute',
                          bottom: 0,
                          left: 0,
                          right: 0,
                          height: 3,
                          backgroundColor: getLineColor(stage.line_code ?? stage.mode ?? ''),
                        }}
                      />
                    </View>
                  )}
                  {i < arr.length - 1 && <Text style={{ color: '#CCCCCC', fontSize: 12 }}>›</Text>}
                </Fragment>
              ))
            )}
          </View>

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, marginBottom: 4 }}>
            <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: '#22c55e' }} />
            <Text style={{ color: '#22c55e', fontSize: 12, fontWeight: '500' }} numberOfLines={1}>
              {departureInfoLine}
            </Text>
          </View>
          <Text style={{ color: '#999999', fontSize: 12, marginBottom: 12 }} numberOfLines={2}>
            {odSummary}
          </Text>

          <View style={{ height: 0.5, backgroundColor: '#EEEEEE', marginBottom: 10 }} />

          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, flex: 1 }}>
              {accessibilityStatus && (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    backgroundColor: accessibilityStatus.bg,
                    borderRadius: 20,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                  }}
                >
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: accessibilityStatus.fg,
                    }}
                  />
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '500',
                      color: accessibilityStatus.label === 'Acessível' ? '#166534' : '#991B1B',
                    }}
                  >
                    {accessibilityStatus.label}
                  </Text>
                </View>
              )}
              {hasAttentionSegments && (() => {
                const reason =
                  routeAttentionReason(route as RouteItem) ??
                  route.warning ??
                  route.accompanied_warning ??
                  'Este trajeto contém trechos que requerem atenção.';
                return (
                  <TouchableOpacity
                    onPress={() => Alert.alert('Atenção neste trajeto', reason)}
                    style={{
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      backgroundColor: '#FEF3C7',
                      borderRadius: 20,
                      paddingHorizontal: 10,
                      paddingVertical: 4,
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Atenção: ${reason}`}
                  >
                    <View style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: '#D97706' }} />
                    <Text style={{ fontSize: 11, fontWeight: '500', color: '#92400E' }}>Atenção</Text>
                  </TouchableOpacity>
                );
              })()}
              {/* Score de acessibilidade existe no backend; não exibimos no card */}
              {rainChip && (
                <View
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 4,
                    backgroundColor: rainChip.icon === 'weather-pouring' ? '#FEE2E2' : '#FEF3C7',
                    borderRadius: 20,
                    paddingHorizontal: 10,
                    paddingVertical: 4,
                  }}
                >
                  <View
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: rainChip.icon === 'weather-pouring' ? '#DC2626' : '#D97706',
                    }}
                  />
                  <Text
                    style={{
                      fontSize: 11,
                      fontWeight: '500',
                      color: rainChip.icon === 'weather-pouring' ? '#991B1B' : '#92400E',
                    }}
                  >
                    {rainChip.icon === 'weather-rainy' ? 'Chuva leve' : 'Chuva forte'}
                  </Text>
                </View>
              )}
            </View>

            <TouchableOpacity
              onPress={() => openRouteDetail(route, cardIndex)}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                backgroundColor: '#0057A8',
                borderRadius: 20,
                paddingHorizontal: 14,
                paddingVertical: 7,
                flexShrink: 0,
              }}
              activeOpacity={0.88}
              accessibilityRole="button"
              accessibilityLabel="Ver trechos e detalhes da rota no mapa"
            >
              <MaterialCommunityIcons name="map-search" size={13} color="#FFFFFF" />
              <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '500' }}>Trechos</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    );
  };

  return (
    <SafeAreaView style={[styles.screen, sx.fillScreen]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, sx.fillCard, { paddingTop: insets.top + 16 }]}>
        <View style={styles.headerOriginDestWrap}>
          <View style={styles.headerOriginDestBlock}>
            <View style={styles.headerIconsColumn}>
              <View style={styles.headerLeadIconRow}>
                <TouchableOpacity
                  onPress={() => router.back()}
                  hitSlop={A11Y_HIT_SLOP}
                  accessibilityRole="button"
                  accessibilityLabel="Voltar"
                >
                  <MaterialCommunityIcons name="arrow-left" size={22} color="#0057A8" />
                </TouchableOpacity>
              </View>
              {middleStop !== null ? (
                <View style={styles.headerLeadIconRow}>
                  <MaterialCommunityIcons name="map-marker-outline" size={16} color="#6B7280" />
                </View>
              ) : null}
              <View style={styles.headerLeadIconRow}>
                <MaterialCommunityIcons name="map-marker" size={18} color="#FF6B00" />
              </View>
            </View>
            <View
              style={[
                styles.headerFieldsColumn,
                middleStop !== null ? styles.headerFieldsColumnWithStop : null,
              ]}
            >
              <View style={styles.field}>
                <TextInput
                  value={headerOrigin}
                  onChangeText={(text) => {
                    setHeaderOrigin(text);
                    setHistoryOriginTitle(undefined);
                    if (activeSearchField !== 'origin') setActiveSearchField('origin');
                  }}
                  onFocus={() => setActiveSearchField('origin')}
                  placeholder="Origem (GPS automático)"
                  placeholderTextColor="#9CA3AF"
                  style={styles.fieldInput}
                  returnKeyType="next"
                  accessibilityLabel="Origem da viagem"
                />
              </View>
              {activeSearchField === 'origin' && placeSuggestions.length > 0 ? (
                <View style={styles.suggestionsInlineWrap}>
                  <View style={styles.suggestionsBox}>
                    <ScrollView
                      nestedScrollEnabled
                      style={styles.suggestionsScroll}
                      contentContainerStyle={styles.suggestionsContent}
                      keyboardShouldPersistTaps="handled"
                    >
                      {placeSuggestions.map((item, idx) => (
                        <TouchableOpacity
                          key={`${activeSearchField}-s-${idx}`}
                          style={[
                            styles.suggestionItem,
                            idx < placeSuggestions.length - 1 ? styles.suggestionItemDivider : null,
                          ]}
                          onPress={() => {
                            Keyboard.dismiss();
                            setHeaderOrigin(item.description);
                            setHistoryOriginTitle(item.mainText);
                            setActiveSearchField(null);
                            setPlaceSuggestions([]);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={item.description}
                        >
                          <Text style={styles.suggestionText} numberOfLines={2}>{item.description}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                </View>
              ) : null}
              {middleStop !== null ? (
                <View style={styles.headerStopRow}>
                  <TextInput
                    style={[styles.field, styles.headerWaypointInput, { flex: 1, minWidth: 0 }]}
                    value={middleStop}
                    onChangeText={(text) => {
                      setMiddleStop(text);
                      if (activeSearchField !== 'waypoint') setActiveSearchField('waypoint');
                    }}
                    onFocus={() => setActiveSearchField('waypoint')}
                    placeholder="Adicione uma parada"
                    placeholderTextColor="#9CA3AF"
                    accessibilityLabel="Parada intermediária"
                  />
                  <TouchableOpacity
                    onPress={handleRemoveMiddleStop}
                    accessibilityRole="button"
                    accessibilityLabel="Remover parada"
                    hitSlop={A11Y_HIT_SLOP}
                  >
                    <MaterialCommunityIcons name="close-circle-outline" size={22} color="#9CA3AF" />
                  </TouchableOpacity>
                </View>
              ) : null}
              {activeSearchField === 'waypoint' && placeSuggestions.length > 0 ? (
                <View style={styles.suggestionsInlineWrap}>
                  <View style={styles.suggestionsBox}>
                    <ScrollView
                      nestedScrollEnabled
                      style={styles.suggestionsScroll}
                      contentContainerStyle={styles.suggestionsContent}
                      keyboardShouldPersistTaps="handled"
                    >
                      {placeSuggestions.map((item, idx) => (
                        <TouchableOpacity
                          key={`${activeSearchField}-s-${idx}`}
                          style={[
                            styles.suggestionItem,
                            idx < placeSuggestions.length - 1 ? styles.suggestionItemDivider : null,
                          ]}
                          onPress={() => {
                            Keyboard.dismiss();
                            setMiddleStop(item.description);
                            setActiveSearchField(null);
                            setPlaceSuggestions([]);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={item.description}
                        >
                          <Text style={styles.suggestionText} numberOfLines={2}>{item.description}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                </View>
              ) : null}
              <View style={styles.field}>
                <TextInput
                  value={headerDestination}
                  onChangeText={(text) => {
                    setHeaderDestination(text);
                    setHistoryDestinationTitle(undefined);
                    if (activeSearchField !== 'destination') setActiveSearchField('destination');
                  }}
                  onFocus={() => setActiveSearchField('destination')}
                  placeholder="Digite o destino"
                  placeholderTextColor="#9CA3AF"
                  style={styles.fieldInput}
                  returnKeyType="search"
                  onSubmitEditing={() => {
                    Keyboard.dismiss();
                    setActiveSearchField(null);
                    setPlaceSuggestions([]);
                    fetchRoutesForHeader();
                  }}
                  accessibilityLabel="Destino da viagem"
                />
              </View>
              {activeSearchField === 'destination' && placeSuggestions.length > 0 ? (
                <View style={styles.suggestionsInlineWrap}>
                  <View style={styles.suggestionsBox}>
                    <ScrollView
                      nestedScrollEnabled
                      style={styles.suggestionsScroll}
                      contentContainerStyle={styles.suggestionsContent}
                      keyboardShouldPersistTaps="handled"
                    >
                      {placeSuggestions.map((item, idx) => (
                        <TouchableOpacity
                          key={`${activeSearchField}-s-${idx}`}
                          style={[
                            styles.suggestionItem,
                            idx < placeSuggestions.length - 1 ? styles.suggestionItemDivider : null,
                          ]}
                          onPress={() => {
                            Keyboard.dismiss();
                            setHeaderDestination(item.description);
                            setHistoryDestinationTitle(item.mainText);
                            setActiveSearchField(null);
                            setPlaceSuggestions([]);
                          }}
                          accessibilityRole="button"
                          accessibilityLabel={item.description}
                        >
                          <Text style={styles.suggestionText} numberOfLines={2}>{item.description}</Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                </View>
              ) : null}
            </View>
          </View>
        </View>

        <View style={styles.headerCompanionBlock}>
          <View style={styles.headerCompanionTabsWrap}>
            <TouchableOpacity
              style={styles.companionTabBtn}
              onPress={() => setActiveCompanionTab('alone')}
              activeOpacity={0.85}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeCompanionTab === 'alone' }}
              accessibilityLabel="Viajar sozinho"
            >
              <Text
                style={[
                  styles.companionTabText,
                  activeCompanionTab === 'alone' ? styles.companionTabTextActive : null,
                ]}
              >
                Sozinho
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.companionTabBtn}
              onPress={() => setActiveCompanionTab('companied')}
              activeOpacity={0.85}
              accessibilityRole="tab"
              accessibilityState={{ selected: activeCompanionTab === 'companied' }}
              accessibilityLabel="Viajar acompanhado"
            >
              <Text
                style={[
                  styles.companionTabText,
                  activeCompanionTab === 'companied' ? styles.companionTabTextActive : null,
                ]}
              >
                Acompanhado
              </Text>
            </TouchableOpacity>
          </View>
          <View style={styles.headerCompanionBottomBar} pointerEvents="none">
            <View
              style={[
                styles.headerCompanionBottomHalf,
                activeCompanionTab === 'alone'
                  ? styles.headerCompanionBottomHalfActive
                  : styles.headerCompanionBottomHalfMuted,
              ]}
            />
            <View
              style={[
                styles.headerCompanionBottomHalf,
                activeCompanionTab === 'companied'
                  ? styles.headerCompanionBottomHalfActive
                  : styles.headerCompanionBottomHalfMuted,
              ]}
            />
          </View>
        </View>

      </View>

      {showRouteResults ? (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingBottom: 28 }}>
        <View style={styles.filterRowWrap}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            style={styles.filterChipsScroll}
            contentContainerStyle={styles.filterChipsContent}
            keyboardShouldPersistTaps="handled"
          >
            <TouchableOpacity
              style={styles.filterChip}
              activeOpacity={0.85}
              onPress={() => {
                Keyboard.dismiss();
                setShowTimeFilterList((prev) => !prev);
              }}
              accessibilityRole="button"
              accessibilityLabel={`Filtro de horário: ${selectedTimeFilter.label}`}
              accessibilityState={{ expanded: showTimeFilterList }}
            >
              <Text style={styles.filterChipText}>{selectedTimeFilter.label}</Text>
              <MaterialCommunityIcons name="chevron-down" size={16} color="#4B5563" />
            </TouchableOpacity>
            {ROUTE_PREFERENCE_OPTIONS.map((pref) => {
              const selected =
                pref.key === 'less_transfers' ? preferLessTransfers : preferLessWalking;
              return (
                <TouchableOpacity
                  key={pref.key}
                  style={[styles.filterChip, selected ? styles.filterChipActive : null]}
                  activeOpacity={0.85}
                  onPress={() => {
                    Keyboard.dismiss();
                    if (pref.key === 'less_transfers') {
                      const next = !preferLessTransfers;
                      setPreferLessTransfers(next);
                      if (next) setPreferLessWalking(false);
                      void fetchRoutesForHeader({
                        preferLessTransfers: next,
                        preferLessWalking: next ? false : preferLessWalking,
                      });
                    } else {
                      const next = !preferLessWalking;
                      setPreferLessWalking(next);
                      if (next) setPreferLessTransfers(false);
                      void fetchRoutesForHeader({
                        preferLessWalking: next,
                        preferLessTransfers: next ? false : preferLessTransfers,
                      });
                    }
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Preferência de rota: ${pref.label}. Toque para ligar ou desligar`}
                  accessibilityHint="Menos trocas e Caminhar menos não podem ficar ativos ao mesmo tempo"
                  accessibilityState={{ selected }}
                >
                  <MaterialCommunityIcons
                    name={pref.icon}
                    size={16}
                    color={selected ? '#FFFFFF' : '#4B5563'}
                  />
                  <Text style={[styles.filterChipText, selected ? styles.filterChipTextActive : null]}>
                    {pref.label}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
          {showTimeFilterList ? (
            <View style={styles.timeFilterList}>
              {TIME_FILTER_OPTIONS.map((option) => {
                const selected = option.key === selectedTimeFilter.key;
                return (
                  <TouchableOpacity
                    key={option.key}
                    style={[styles.timeFilterListItem, selected ? styles.timeFilterListItemSelected : null]}
                    activeOpacity={0.85}
                    onPress={() => {
                      if (
                        option.key === 'set_departure_time' ||
                        option.key === 'set_arrival_time'
                      ) {
                        Keyboard.dismiss();
                        setShowTimeFilterList(false);
                        openManualTimeModal(option.key);
                        return;
                      }
                      setSelectedTimeFilter(option);
                      fetchRoutesForHeader({ timeOption: option });
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={option.label}
                    accessibilityState={{ selected }}
                  >
                    <Text
                      style={[
                        styles.timeFilterListItemText,
                        selected ? styles.timeFilterListItemTextSelected : null,
                      ]}
                    >
                      {option.label}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          ) : null}
        </View>

        <Text style={styles.sectionTitleMuted}>Táxi e transporte privado</Text>
        <TouchableOpacity
          onPress={() => Linking.openURL(uberDeepLink)}
          style={styles.uberCard}
          activeOpacity={0.9}
          accessibilityRole="button"
          accessibilityLabel="Pedir corrida no Uber"
          accessibilityHint="Abre o aplicativo Uber"
        >
          <View style={styles.uberLeft}>
            <View style={styles.uberLogo}>
              <Text style={styles.uberLogoText}>U</Text>
            </View>
            <View>
              <Text style={styles.uberTitle}>Pedir um Uber</Text>
              <Text style={styles.uberSub}>Toque para pedir uma corrida</Text>
            </View>
          </View>
          <View style={styles.uberButton}>
            <Text style={styles.uberButtonText}>Pedir</Text>
          </View>
        </TouchableOpacity>

        <View style={styles.sectionHeader}>
          <Text style={styles.sectionTitleStrong}>Rotas sugeridas</Text>
        </View>

        {suggestedRoutesRefetchLoading ? (
          <View
            style={styles.emptyRoutesWrap}
            accessibilityLiveRegion="polite"
            accessibilityLabel="Carregando trajetos"
          >
            <ActivityIndicator size="large" color="#0057A8" />
            <Text style={styles.emptyRoutesHintText}>Carregando trajetos…</Text>
          </View>
        ) : (
          <>
            {mostAccessibleRoute ? renderRouteCard(mostAccessibleRoute, 'most-accessible', true, 0) : null}

            {filteredRoutes.length === 0 ? (
            initialRoutesLoading ? (
              <View style={styles.emptyRoutesWrap}>
                <ActivityIndicator size="large" color="#0057A8" />
                <Text style={styles.emptyRoutesHintText}>Carregando trajetos…</Text>
              </View>
            ) : hasTypedAddress ? (
                <Text style={styles.emptyRoutesText}>
                  Nao encontramos uma rota tranquila para esse perfil agora. Tente ajustar o horario ou
                  alternar entre Sozinho e Acompanhado.
                </Text>
              ) : (
                <View style={styles.emptyRoutesWrap}>
                  <MaterialCommunityIcons name="map-search-outline" size={40} color="#CCCCCC" />
                  <Text style={styles.emptyRoutesHintText}>Digite um endereco para ver sugestoes de trajetos.</Text>
                </View>
              )
            ) : null}
            {displayedRoutes.map((route, index) =>
              renderRouteCard(route, `route-${index}`, false, mostAccessibleRoute ? index + 1 : index),
            )}
          </>
        )}
      </ScrollView>
      ) : (
        <View style={styles.preSearchArea}>
          <MaterialCommunityIcons name="map-search-outline" size={48} color="#CBD5E1" />
          <Text style={styles.preSearchTitle}>Pronto para pesquisar</Text>
          <Text style={styles.preSearchText}>
            Confira origem e destino acima e toque em Buscar rotas para ver táxi, Uber e trajetos sugeridos.
          </Text>
        </View>
      )}
      <Modal
        transparent
        animationType="fade"
        visible={showManualTimeModal}
        onRequestClose={handleManualTimeCancel}
      >
        <View style={styles.manualTimeBackdrop}>
          <View style={styles.manualTimeSheet}>
            <Text style={styles.manualTimeTitle}>
              {pendingTimeFilterKey === 'set_arrival_time'
                ? 'Definir horário de chegada desejado'
                : 'Definir horário de saída'}
            </Text>
            <View style={styles.manualTimeDigitsRow}>
              <View style={styles.manualTimeDigitsInner} pointerEvents="box-none">
                {[0, 1].map((idx) => (
                  <View key={`d-${idx}`} style={styles.manualTimeDigitBox}>
                    <Text style={styles.manualTimeDigitText}>{manualTimeRaw[idx] ?? ''}</Text>
                  </View>
                ))}
                <Text style={styles.manualTimeSeparator}>:</Text>
                {[2, 3].map((idx) => (
                  <View key={`d-${idx}`} style={styles.manualTimeDigitBox}>
                    <Text style={styles.manualTimeDigitText}>{manualTimeRaw[idx] ?? ''}</Text>
                  </View>
                ))}
                <TextInput
                  ref={manualTimeInputRef}
                  value={manualTimeRaw}
                  onChangeText={(t) => setManualTimeRaw(t.replace(/\D/g, '').slice(0, 4))}
                  keyboardType="number-pad"
                  maxLength={4}
                  caretHidden
                  style={styles.manualTimeHiddenInput}
                  textAlign="center"
                  accessibilityLabel="Horário em 4 dígitos, hora e minuto"
                  accessibilityHint="Toque nos quadrados e digite quatro números; eles preenchem em sequência"
                />
              </View>
            </View>
            <View style={styles.manualTimeActions}>
              <TouchableOpacity
                style={styles.manualTimeConfirmBtn}
                onPress={handleManualTimeConfirm}
                accessibilityRole="button"
                accessibilityLabel="Confirmar horário"
              >
                <Text style={styles.manualTimeConfirmText}>Concluído</Text>
              </TouchableOpacity>
              <TouchableOpacity
                onPress={handleManualTimeCancel}
                accessibilityRole="button"
                accessibilityLabel="Cancelar edição de horário"
              >
                <Text style={styles.manualTimeCancelText}>Cancelar</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F5F5F5' },
  header: {
    position: 'relative',
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 12,
    paddingTop: 12,
    paddingBottom: 0,
  },
  headerOriginDestWrap: { position: 'relative', paddingBottom: 10 },
  /** Abas + faixa inferior de 50% / 50%; o fundo do header termina nessa linha. */
  headerCompanionBlock: {
    alignSelf: 'stretch',
    width: '100%',
    marginHorizontal: -12,
    marginTop: 2,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: '#E5E7EB',
  },
  headerCompanionTabsWrap: {
    flexDirection: 'row',
  },
  headerCompanionBottomBar: {
    flexDirection: 'row',
    width: '100%',
    height: 3,
  },
  headerCompanionBottomHalf: {
    flex: 1,
    minWidth: 0,
    height: 3,
  },
  headerCompanionBottomHalfActive: {
    backgroundColor: '#0057A8',
  },
  headerCompanionBottomHalfMuted: {
    backgroundColor: '#E5E7EB',
  },
  preSearchArea: {
    flex: 1,
    backgroundColor: '#F5F5F5',
    paddingHorizontal: 32,
    paddingVertical: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  preSearchTitle: {
    marginTop: 16,
    fontSize: 17,
    color: '#1E1D1D',
    fontFamily: 'Agrandir-TextBold',
    textAlign: 'center',
  },
  preSearchText: {
    marginTop: 10,
    fontSize: 14,
    color: '#6B7280',
    fontFamily: 'Agrandir-Regular',
    textAlign: 'center',
    lineHeight: 20,
  },
  /** Ícones à esquerda + coluna única de campos: origem e destino com a mesma largura de barra. */
  headerOriginDestBlock: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  headerIconsColumn: { width: 26, gap: 8 },
  headerLeadIconRow: { height: 40, alignItems: 'center', justifyContent: 'center' },
  headerFieldsColumn: { flex: 1, marginRight: 8, gap: 8, minWidth: 0 },
  /** Com parada, afasta coluna do overlay de troca (swap ~78px da borda). */
  headerFieldsColumnWithStop: { marginRight: 14 },
  headerWaypointInput: {
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
    fontSize: 13,
    color: '#1E1D1D',
    textAlignVertical: 'center',
  },
  fieldInput: {
    color: '#1E1D1D',
    fontSize: 13,
    paddingVertical: Platform.OS === 'ios' ? 10 : 8,
  },
  suggestionsBox: {
    marginTop: 8,
    backgroundColor: '#FFFFFF',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    maxHeight: 150,
    overflow: 'hidden',
  },
  suggestionsInlineWrap: {
    marginBottom: 4,
  },
  suggestionsScroll: {
    flexGrow: 0,
  },
  suggestionsContent: {
    paddingVertical: 4,
  },
  suggestionsEmpty: {
    paddingHorizontal: 10,
    paddingVertical: 10,
  },
  suggestionItem: {
    paddingHorizontal: 16,
    paddingVertical: 12,
  },
  suggestionItemDivider: {
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  suggestionText: {
    color: '#1E1D1D',
    fontSize: 14,
    lineHeight: 20,
  },
  headerStopRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingRight: 6 },
  headerPlusBtnDisabled: { opacity: 0.4 },
  headerSwapOverlay: {
    position: 'absolute',
    right: 8,
    top: 4,
    height: 88,
    width: 34,
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerActionsOverlay: {
    position: 'absolute',
    right: 8,
    top: 2,
    height: 92,
    width: 36,
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  headerPlusBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F5F5F5',
    alignItems: 'center',
    justifyContent: 'center',
  },
  field: { backgroundColor: '#F5F5F5', borderRadius: 8, paddingHorizontal: 10, height: 40, justifyContent: 'center' },
  fieldText: { color: '#1E1D1D', fontSize: 13 },
  swap: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#F5F5F5',
    borderWidth: 1,
    borderColor: '#0057A8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionTitleMuted: { color: '#999999', fontSize: 13, marginHorizontal: 16, marginTop: 16 },
  uberCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginTop: 8,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 5,
    elevation: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  uberLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  uberLogo: {
    width: 40,
    height: 40,
    borderRadius: 8,
    backgroundColor: '#1E1D1D',
    alignItems: 'center',
    justifyContent: 'center',
  },
  uberLogoText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
    fontFamily: 'Agrandir-TextBold',
  },
  uberTitle: {
    color: '#1E1D1D',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'Agrandir-TextBold',
  },
  uberSub: {
    color: '#999999',
    fontSize: 12,
    fontFamily: 'Agrandir-Regular',
  },
  uberButton: {
    backgroundColor: '#1E1D1D',
    borderRadius: 20,
    paddingHorizontal: 16,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  uberButtonText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    fontFamily: 'Agrandir-Regular',
  },
  sectionHeader: {
    marginHorizontal: 16,
    marginTop: 20,
    marginBottom: 8,
  },
  sectionTitleStrong: {
    color: '#1E1D1D',
    fontSize: 15,
    fontFamily: 'Agrandir-TextBold',
  },
  filterChipsScroll: {
    maxHeight: 48,
  },
  filterChipsContent: {
    paddingHorizontal: 16,
    gap: 8,
    alignItems: 'center',
  },
  filterRowWrap: {
    position: 'relative',
    marginTop: 16,
    marginBottom: 8,
    zIndex: 20,
  },
  filterChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  filterChipActive: {
    backgroundColor: '#0057A8',
    borderColor: '#0057A8',
  },
  filterChipText: {
    color: '#374151',
    fontSize: 13,
    fontFamily: 'Agrandir-Regular',
  },
  filterChipTextActive: {
    color: '#FFFFFF',
  },
  timeFilterList: {
    position: 'absolute',
    top: 50,
    left: 16,
    width: 250,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  timeFilterListItem: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: '#EEF2F7',
  },
  timeFilterListItemSelected: {
    backgroundColor: '#EFF6FF',
  },
  timeFilterListItemText: {
    color: '#334155',
    fontSize: 13,
    fontWeight: '500',
  },
  timeFilterListItemTextSelected: {
    color: '#0057A8',
    fontWeight: '700',
  },
  manualTimeBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.45)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  manualTimeSheet: {
    width: '100%',
    maxWidth: 360,
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingTop: 18,
    paddingBottom: 16,
  },
  manualTimeTitle: {
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 14,
  },
  manualTimeDigitsRow: {
    marginBottom: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualTimeDigitsInner: {
    position: 'relative',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    minHeight: 54,
    minWidth: 220,
  },
  manualTimeDigitBox: {
    width: 46,
    height: 54,
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#93C5FD',
    backgroundColor: '#F8FAFC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualTimeDigitText: {
    color: '#0F172A',
    fontSize: 28,
    fontWeight: '700',
  },
  manualTimeHiddenInput: {
    ...StyleSheet.absoluteFillObject,
    opacity: 0.04,
    color: 'transparent',
    fontSize: 1,
    zIndex: 2,
  },
  manualTimeSeparator: {
    color: '#334155',
    fontSize: 26,
    fontWeight: '700',
    marginHorizontal: 2,
  },
  manualTimeActions: {
    alignItems: 'center',
    gap: 12,
  },
  manualTimeConfirmBtn: {
    width: '100%',
    height: 48,
    borderRadius: 24,
    backgroundColor: '#3B82F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  manualTimeConfirmText: {
    color: '#FFFFFF',
    fontSize: 17,
    fontWeight: '700',
  },
  manualTimeCancelText: {
    color: '#2563EB',
    fontSize: 18,
    fontWeight: '600',
  },
  routeStagesFrame: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    borderRadius: 10,
    backgroundColor: '#FAFAFA',
    paddingHorizontal: 10,
    paddingVertical: 6,
    marginBottom: 8,
  },
  routeCardStagesScrollContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  companionTabBtn: {
    flex: 1,
    minWidth: 0,
    paddingVertical: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  companionTabText: {
    color: '#6B7280',
    fontSize: 13,
    fontWeight: '700',
  },
  companionTabTextActive: {
    color: '#0057A8',
  },
  emptyRoutesWrap: {
    alignItems: 'center',
    paddingVertical: 18,
    marginHorizontal: 16,
  },
  emptyRoutesHintText: {
    color: '#999999',
    fontSize: 14,
    marginTop: 8,
    textAlign: 'center',
  },
  emptyRoutesText: {
    marginHorizontal: 16,
    marginBottom: 10,
    color: '#6B7280',
    fontSize: 13,
    fontWeight: '600',
  },
  routeCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    marginHorizontal: 16,
    marginBottom: 10,
    shadowColor: '#000',
    shadowOpacity: 0.06,
    shadowRadius: 8,
    elevation: 2,
  },
});
