import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Modal,
  SafeAreaView,
  ScrollView,
  SectionList,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import { ScaledText as Text } from '@/components/ScaledText';
import { ScaledTextInput as TextInput } from '@/components/ScaledTextInput';
import { useAccessibilitySurfaces } from '@/contexts/accessibility-preferences';
import { A11Y_HIT_SLOP } from '@/constants/accessibility';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_URL } from '../constants/api';
import type { LineItem } from '../mocks/lines';
import { MOCK_LINES, MOCK_LINE_STOPS } from '../mocks/lines';
import { getToken } from '../services/token.service';
import {
  detectLinesRegionFromCoords,
  linesRegionLabel,
  type LinesRegionId,
} from '../utils/lines-region';
import { nextScheduleToday, normalizeSchedulesFromApi } from '../utils/schedule-time';

const TABS = ['todos', 'favoritos'] as const;
const TAB_LABELS: Record<(typeof TABS)[number], string> = {
  todos: 'Todos',
  favoritos: 'Favoritos',
};

const RECENT_LINES_KEY = 'recent_lines';
const MAX_RECENTS = 5;

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

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

function lineCoordinates(code: string) {
  const baseLat = -16.7167;
  const baseLng = -43.8647;
  const parsed = parseInt(code, 10) || 1;
  const offset = (parsed % 6) * 0.005 + 0.004;
  return {
    origin: { latitude: baseLat - offset, longitude: baseLng - offset / 2 },
    destination: { latitude: baseLat + offset / 2, longitude: baseLng + offset },
  };
}

const calculateDistanceNum = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): string => {
  const distance = calculateDistanceNum(lat1, lng1, lat2, lng2);
  return distance < 1000 ? `${Math.round(distance)}m` : `${(distance / 1000).toFixed(1)}km`;
};

const getWalkTime = (distanceNum: number): string => {
  const minutes = Math.round(distanceNum / 80);
  if (minutes < 1) return '1 min a pé';
  if (minutes < 60) return `${minutes} min a pé`;
  const hours = Math.floor(minutes / 60);
  const remaining = minutes % 60;
  return remaining === 0 ? `${hours}h a pé` : `${hours}h ${remaining}min a pé`;
};

const getMinutesUntil = (time: string): number => {
  const now = new Date();
  const [h, m] = time.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return 0;
  const target = new Date();
  target.setHours(h, m, 0, 0);
  if (target.getTime() < now.getTime()) target.setDate(target.getDate() + 1);
  return Math.max(0, (target.getTime() - now.getTime()) / 60000);
};

const formatArrivalTime = (minutesRaw: number): string => {
  const minutes = Math.max(0, Math.round(minutesRaw));
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  if (remainingMinutes === 0) return `${hours}h`;
  return `${hours}h ${remainingMinutes}min`;
};

const getLineRoute = (line: LineItem | null) => {
  if (!line) return [];
  return MOCK_LINE_STOPS.filter((s) => s.lines.includes(line.code)).map((s) => ({
    latitude: s.lat,
    longitude: s.lng,
  }));
};

function parseLineRegionRaw(raw: unknown): LinesRegionId {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'brasilia' || s === 'brasília') return 'brasilia';
  if (s === 'sao_paulo' || s === 'são_paulo') return 'sao_paulo';
  return 'montes_claros';
}

function normalizeLine(raw: Record<string, unknown>, index: number): LineItem {
  return {
    id: String(raw.id ?? `line-${index}`),
    region: parseLineRegionRaw(raw.region),
    type: raw.type === 'metro' ? 'metro' : 'bus',
    code: String(raw.code ?? raw.number ?? '-'),
    name: String(raw.name ?? 'Linha'),
    origin: String(raw.origin ?? '-'),
    destination: String(raw.destination ?? '-'),
    via: raw.via ? String(raw.via) : null,
    accessible: Boolean(raw.accessible),
    operator: String(raw.operator ?? 'MOC BUS'),
    color: String(raw.color ?? '#0057A8'),
    schedules: normalizeSchedulesFromApi(raw.schedules),
  };
}

function LineRow({ item, onPress }: { item: LineItem; onPress: () => void }) {
  const sx = useAccessibilitySurfaces();
  const itemNext = nextScheduleToday(item.schedules);
  const modeIcon = item.type === 'metro' ? ('subway-variant' as const) : ('bus' as const);
  const a11yHint = item.accessible ? 'Linha acessível' : 'Linha pode não ser acessível';
  const nextLabel = itemNext ? `Próximo horário ${itemNext}` : 'Sem horários cadastrados';
  return (
    <TouchableOpacity
      style={[styles.lineItem, sx.fillCard, sx.listSeparator]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Linha ${item.code}, ${item.name}. ${nextLabel}. ${a11yHint}`}
    >
      <View style={[styles.lineCodeBadge, sx.fillCard, sx.outlineBorder]}>
        <View style={styles.lineCodeRow}>
          <MaterialCommunityIcons name={modeIcon} size={11} color="#1E1D1D" />
          <Text style={styles.lineCodeText}>{item.code}</Text>
        </View>
        <View style={[styles.lineCodeBottomBar, { backgroundColor: getLineColor(item.code) }]} />
      </View>
      <View style={styles.lineMain}>
        <View style={styles.lineTitleRow}>
          <Text style={styles.lineName} numberOfLines={1}>
            {item.name}
          </Text>
          {item.alert ? (
            <View
              style={{
                width: 8,
                height: 8,
                borderRadius: 4,
                backgroundColor:
                  item.alert === 'red' ? '#EF4444' : item.alert === 'yellow' ? '#F59E0B' : '#22c55e',
                marginLeft: 6,
              }}
            />
          ) : null}
          {item.accessible ? (
            <MaterialCommunityIcons name="wheelchair-accessibility" size={14} color="#16A34A" />
          ) : (
            <MaterialCommunityIcons name="wheelchair-accessibility" size={14} color="#EF4444" />
          )}
        </View>
        {item.via ? <Text style={styles.lineVia}>Via {item.via}</Text> : null}
        {itemNext ? (
          <Text style={styles.nextBusText}>Próximo: {itemNext}</Text>
        ) : (
          <Text style={styles.noScheduleText}>Sem horários cadastrados</Text>
        )}
      </View>
      <MaterialCommunityIcons name="chevron-right" size={18} color="#CCCCCC" />
    </TouchableOpacity>
  );
}

function RecentLinesRow({
  recents,
  onSelect,
}: {
  recents: LineItem[];
  onSelect: (line: LineItem) => void;
}) {
  const sx = useAccessibilitySurfaces();
  if (recents.length === 0) return null;
  return (
    <View style={[recentStyles.wrapper, sx.fillCard, sx.hairlineBottom]}>
      <Text style={recentStyles.title}>Recentes</Text>
      {recents.map((line) => (
        <LineRow key={line.id} item={line} onPress={() => onSelect(line)} />
      ))}
    </View>
  );
}

export default function LinesScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const sx = useAccessibilitySurfaces();
  const sheetAnim = useRef(new Animated.Value(0)).current;

  const [loading, setLoading] = useState(true);
  const [lines, setLines] = useState<LineItem[]>([]);
  const [filtered, setFiltered] = useState<LineItem[]>([]);
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<(typeof TABS)[number]>('todos');
  const [selectedLine, setSelectedLine] = useState<LineItem | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  // FIX 2: estado de recentes
  const [recentIds, setRecentIds] = useState<string[]>([]);
  const [isDemo, setIsDemo] = useState(false);
  const [modalVisible, setModalVisible] = useState(false);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [linesRegion, setLinesRegion] = useState<LinesRegionId>('montes_claros');

  useEffect(() => {
    AsyncStorage.getItem('favorite_lines').then((favs) => {
      if (favs) setFavorites(JSON.parse(favs) as string[]);
    });
    // Carregar recentes
    AsyncStorage.getItem(RECENT_LINES_KEY).then((recents) => {
      if (recents) setRecentIds(JSON.parse(recents) as string[]);
    });
  }, []);

  useEffect(() => {
    (async () => {
      try {
        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status !== 'granted') return;
        const current = await Location.getCurrentPositionAsync({});
        setUserLocation({ latitude: current.coords.latitude, longitude: current.coords.longitude });
      } catch {
        setUserLocation(null);
      }
    })();
  }, []);

  useEffect(() => {
    if (!userLocation) return;
    const detected = detectLinesRegionFromCoords(
      userLocation.latitude,
      userLocation.longitude,
    );
    if (detected) setLinesRegion(detected);
  }, [userLocation]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const token = await getToken();
        const q = new URLSearchParams({ region: linesRegion });
        const response = await fetch(`${API_URL}/lines?${q.toString()}`, {
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        const data = response.ok ? ((await response.json()) as unknown) : [];
        if (cancelled) return;
        if (Array.isArray(data) && data.length > 0) {
          setLines(data.map((item, index) => normalizeLine(item as Record<string, unknown>, index)));
          setIsDemo(false);
        } else {
          setLines(MOCK_LINES.filter((m) => (m.region ?? 'montes_claros') === linesRegion));
          setIsDemo(true);
        }
      } catch {
        if (!cancelled) {
          setLines(MOCK_LINES.filter((m) => (m.region ?? 'montes_claros') === linesRegion));
          setIsDemo(true);
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [linesRegion]);

  useEffect(() => {
    let result = lines;
    if (search) {
      const s = search.toLowerCase();
      result = result.filter(
        (l) =>
          l.code.includes(search) ||
          l.name.toLowerCase().includes(s) ||
          l.origin.toLowerCase().includes(s) ||
          l.destination.toLowerCase().includes(s),
      );
    }
    if (activeFilter === 'favoritos') result = result.filter((l) => favorites.includes(l.id));
    setFiltered(result);
  }, [search, activeFilter, lines, favorites]);

  // FIX 2: linhas recentes resolvidas a partir dos IDs
  const recentLines = useMemo(
    () =>
      recentIds
        .map((id) => lines.find((l) => l.id === id))
        .filter((l): l is LineItem => Boolean(l)),
    [recentIds, lines],
  );

  // FIX 2: salva linha visitada nos recentes
  const saveRecent = async (line: LineItem) => {
    const updated = [line.id, ...recentIds.filter((id) => id !== line.id)].slice(0, MAX_RECENTS);
    setRecentIds(updated);
    await AsyncStorage.setItem(RECENT_LINES_KEY, JSON.stringify(updated));
  };

  const handleSelectLine = async (line: LineItem) => {
    await saveRecent(line); // FIX 2: registra como recente
    setSelectedLine(line);
    setModalVisible(true);
    Animated.spring(sheetAnim, {
      toValue: 1,
      useNativeDriver: true,
      friction: 8,
      tension: 70,
    }).start();
  };

  const toggleFavorite = async (id: string) => {
    const newFavs = favorites.includes(id)
      ? favorites.filter((f) => f !== id)
      : [...favorites, id];
    setFavorites(newFavs);
    await AsyncStorage.setItem('favorite_lines', JSON.stringify(newFavs));
  };

  const closeModal = () => {
    Animated.timing(sheetAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => setModalVisible(false));
  };

  const busSectionSubtitle = linesRegionLabel(linesRegion);

  const sections = useMemo(
    () => [
      {
        title: 'Metrô',
        subtitle: 'Metrô',
        icon: 'subway-variant' as const,
        type: 'metro' as const,
        data: filtered.filter((l) => l.type === 'metro'),
      },
      {
        title: linesRegion === 'montes_claros' ? 'MOC BUS' : 'Ônibus',
        subtitle: busSectionSubtitle,
        icon: 'bus' as const,
        type: 'bus' as const,
        data: filtered.filter((l) => l.type === 'bus'),
      },
    ],
    [filtered, linesRegion, busSectionSubtitle],
  );

  const selectedIsFavorite = selectedLine ? favorites.includes(selectedLine.id) : false;
  // FIX 1: calcular next uma única vez e reusar
  const selectedNext = selectedLine ? nextScheduleToday(selectedLine.schedules) : null;
  const selectedRoute = useMemo(() => getLineRoute(selectedLine), [selectedLine]);
  const selectedStops = useMemo(
    () => (selectedLine ? MOCK_LINE_STOPS.filter((s) => s.lines.includes(selectedLine.code)) : []),
    [selectedLine],
  );
  const nearestStop = useMemo(() => {
    if (!userLocation || !selectedLine) return null;
    return [...MOCK_LINE_STOPS]
      .filter((s) => s.lines.includes(selectedLine.code))
      .sort(
        (a, b) =>
          calculateDistanceNum(userLocation.latitude, userLocation.longitude, a.lat, a.lng) -
          calculateDistanceNum(userLocation.latitude, userLocation.longitude, b.lat, b.lng),
      )[0] ?? null;
  }, [selectedLine, userLocation]);

  const sheetTranslateY = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [SCREEN_HEIGHT, 0],
  });

  return (
    <SafeAreaView style={[styles.container, sx.fillScreen]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, sx.fillCard, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerTop}>
          <Text style={styles.title}>Linhas</Text>
          {isDemo ? (
            <View style={styles.demoBadge}>
              <Text style={styles.demoBadgeText}>Demo</Text>
            </View>
          ) : null}
        </View>
        <View style={[styles.searchBar, sx.searchInset]}>
          <MaterialCommunityIcons name="magnify" size={20} color="#AAAAAA" />
          <TextInput
            style={styles.searchInput}
            placeholder="Pesquise uma linha..."
            placeholderTextColor="#AAAAAA"
            value={search}
            onChangeText={setSearch}
            accessibilityLabel="Pesquisar linha"
          />
          {search.length > 0 ? (
            <TouchableOpacity
              onPress={() => setSearch('')}
              hitSlop={A11Y_HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel="Limpar pesquisa"
            >
              <MaterialCommunityIcons name="close" size={20} color="#AAAAAA" />
            </TouchableOpacity>
          ) : null}
        </View>
      </View>

      <View style={[styles.tabsRow, sx.fillCard, sx.hairlineBottom]}>
        {TABS.map((tab) => {
          const active = activeFilter === tab;
          return (
            <TouchableOpacity
              key={tab}
              style={styles.tabButton}
              onPress={() => setActiveFilter(tab)}
              accessibilityRole="button"
              accessibilityLabel={TAB_LABELS[tab]}
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.tabText, active && styles.tabTextActive]}>{TAB_LABELS[tab]}</Text>
              <View style={[styles.tabIndicator, active && styles.tabIndicatorActive]} />
            </TouchableOpacity>
          );
        })}
      </View>

      {loading ? (
        <View style={styles.centerWrap}>
          <Text style={styles.emptyText}>Carregando linhas...</Text>
        </View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          // FIX 2: Recentes aparecem no topo, apenas na aba "todos" e sem busca ativa
          ListHeaderComponent={
            activeFilter === 'todos' && !search ? (
              <RecentLinesRow recents={recentLines} onSelect={handleSelectLine} />
            ) : null
          }
          renderSectionHeader={({ section }) => (
            <View
              style={[
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 16,
                  paddingVertical: 10,
                  marginTop: 8,
                  width: '100%',
                  alignSelf: 'stretch',
                  borderTopWidth: 1,
                  borderBottomWidth: 1,
                },
                sx.fillCard,
                sx.hairlineTopBottom,
              ]}
            >
              <MaterialCommunityIcons
                name={section.type === 'metro' ? 'subway-variant' : 'bus'}
                size={18}
                color="#1E1D1D"
              />
              <Text style={{ color: '#1E1D1D', fontSize: 14, fontWeight: '700', marginLeft: 8 }}>
                {section.type === 'metro' ? 'Metrô' : 'Ônibus'}
              </Text>
            </View>
          )}
          renderSectionFooter={({ section }) =>
            section.type === 'metro' && section.data.length === 0 ? (
              <View style={styles.metroEmptyWrap}>
                <MaterialCommunityIcons name="subway-variant" size={32} color="#CCCCCC" />
                <Text style={styles.metroEmptyText}>
                  Nenhuma linha de metrô{'\n'}encontrada na sua região
                </Text>
              </View>
            ) : null
          }
          renderItem={({ item }) => (
            <LineRow item={item} onPress={() => handleSelectLine(item)} />
          )}
          contentContainerStyle={styles.sectionContent}
          stickySectionHeadersEnabled={false}
        />
      )}

      <Modal visible={modalVisible} animationType="slide" transparent onRequestClose={closeModal}>
        <TouchableOpacity
          style={styles.modalOverlay}
          activeOpacity={1}
          onPress={closeModal}
          accessibilityRole="button"
          accessibilityLabel="Fechar detalhes da linha"
        />
        <Animated.View style={[styles.sheet, sx.fillCard, { transform: [{ translateY: sheetTranslateY }] }]}>
          <View style={styles.handle} />
          <View style={styles.sheetTop}>
            <View style={[styles.sheetCodeBadge, sx.fillCard, sx.outlineBorder]}>
              <View style={styles.sheetCodeBadgeRow}>
                <MaterialCommunityIcons
                  name={selectedLine?.type === 'metro' ? 'subway-variant' : 'bus'}
                  size={11}
                  color="#1E1D1D"
                />
                <Text style={styles.sheetCodeText}>{selectedLine?.code}</Text>
              </View>
              <View
                style={[styles.sheetCodeBottomBar, { backgroundColor: getLineColor(selectedLine?.code || '0') }]}
              />
            </View>
            <TouchableOpacity
              onPress={() => selectedLine && toggleFavorite(selectedLine.id)}
              hitSlop={A11Y_HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel={selectedIsFavorite ? 'Remover linha dos favoritos' : 'Adicionar linha aos favoritos'}
            >
              <MaterialCommunityIcons
                name={selectedIsFavorite ? 'heart' : 'heart-outline'}
                size={24}
                color="#FF4444"
              />
            </TouchableOpacity>
          </View>

          <ScrollView
            showsVerticalScrollIndicator={false}
            contentContainerStyle={{ paddingBottom: 24 }}
            bounces={false}
          >
            <Text style={[styles.sheetName, { color: getLineColor(selectedLine?.code || '0') }]}>
              {selectedLine?.name}
            </Text>
            <View style={styles.routeRow}>
              <MaterialCommunityIcons name="map-marker" size={16} color="#0057A8" />
              <Text style={styles.routeText}>{selectedLine?.origin}</Text>
              <MaterialCommunityIcons name="arrow-right" size={16} color="#AAAAAA" />
              <Text style={styles.routeText}>{selectedLine?.destination}</Text>
            </View>
            {selectedLine?.via ? (
              <View style={styles.viaRow}>
                <MaterialCommunityIcons name="road-variant" size={14} color="#AAAAAA" />
                <Text style={styles.viaText}>Via {selectedLine.via}</Text>
              </View>
            ) : null}

            <View style={styles.badgesRow}>
              <View style={selectedLine?.accessible ? styles.badgeOk : styles.badgeNo}>
                <Text style={selectedLine?.accessible ? styles.badgeOkText : styles.badgeNoText}>
                  {selectedLine?.accessible ? 'Acessível' : 'Não acessível'}
                </Text>
              </View>
              <View style={styles.badgeOperator}>
                <Text style={styles.badgeOperatorText}>MOC BUS</Text>
              </View>
              {/* FIX 1: mostra horário ou aviso explícito */}
              {selectedNext ? (
                <View style={styles.badgeNext}>
                  <Text style={styles.badgeNextText}>Próximo: {selectedNext}</Text>
                </View>
              ) : (
                <View style={styles.badgeNoSchedule}>
                  <Text style={styles.badgeNoScheduleText}>Sem horários</Text>
                </View>
              )}
              {selectedLine?.alert ? (
                <View style={styles.badgeOperator}>
                  <Text style={styles.badgeOperatorText}>
                    {selectedLine.alertText ?? (selectedLine.alert === 'red'
                      ? 'Sem serviço'
                      : selectedLine.alert === 'yellow'
                        ? 'Mudança moderada'
                        : 'Serviço normal')}
                  </Text>
                </View>
              ) : null}
            </View>

            {selectedLine ? (
              <MapView
                style={{ height: 160, borderRadius: 12, marginBottom: 16, marginTop: 12 }}
                initialRegion={{
                  latitude: -16.7167,
                  longitude: -43.8647,
                  latitudeDelta: 0.08,
                  longitudeDelta: 0.08,
                }}
                scrollEnabled={false}
              >
                {selectedRoute.map((coord, i) => (
                  <Marker key={i} coordinate={coord}>
                    <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: getLineColor(selectedLine.code), borderWidth: 2, borderColor: 'white' }} />
                  </Marker>
                ))}
                {selectedRoute.length >= 2 ? (
                  <Polyline
                    coordinates={selectedRoute}
                    strokeColor={getLineColor(selectedLine.code)}
                    strokeWidth={3}
                  />
                ) : null}
              </MapView>
            ) : null}

            {nearestStop && userLocation ? (
              <View style={{ backgroundColor: '#F5F5F5', borderRadius: 12, padding: 14, marginBottom: 16 }}>
                <Text style={{ color: '#999999', fontSize: 12, fontWeight: '600' }}>PARADA MAIS PRÓXIMA</Text>
                <Text style={{ color: '#1E1D1D', fontSize: 14, fontWeight: '700', marginTop: 4 }}>{nearestStop.name}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 }}>
                  <MaterialCommunityIcons name="walk" size={13} color="#0057A8" />
                  <Text style={{ color: '#0057A8', fontSize: 12, fontWeight: '600' }}>
                    {calculateDistance(userLocation.latitude, userLocation.longitude, nearestStop.lat, nearestStop.lng)}
                    {' • '}
                    {getWalkTime(calculateDistanceNum(userLocation.latitude, userLocation.longitude, nearestStop.lat, nearestStop.lng))}
                  </Text>
                  {nearestStop.nextBus ? (
                    <>
                      <Text style={{ color: '#CCCCCC' }}>•</Text>
                      <MaterialCommunityIcons name="wifi" size={12} color="#22c55e" />
                      <Text style={{ color: '#22c55e', fontSize: 12, fontWeight: '700' }}>
                        {formatArrivalTime(getMinutesUntil(nearestStop.nextBus))}
                      </Text>
                    </>
                  ) : null}
                </View>
              </View>
            ) : null}

            <Text style={{ color: '#1E1D1D', fontSize: 15, fontWeight: '700', marginBottom: 12 }}>
              Todas as paradas ({selectedRoute.length})
            </Text>
            {selectedStops.map((stop, index) => (
              <View key={stop.id} style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 10, borderBottomWidth: 1, borderBottomColor: '#F0F0F0' }}>
                <View style={{ width: 20, alignItems: 'center', marginRight: 12 }}>
                  <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: getLineColor(selectedLine?.code || '0'), borderWidth: 2, borderColor: 'white', zIndex: 1 }} />
                  {index < selectedStops.length - 1 ? (
                    <View style={{ width: 2, height: 30, backgroundColor: getLineColor(selectedLine?.code || '0'), opacity: 0.3, position: 'absolute', top: 10 }} />
                  ) : null}
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: '#1E1D1D', fontSize: 13, fontWeight: stop.id === nearestStop?.id ? '700' : '400' }}>
                    {stop.name}
                  </Text>
                  {stop.id === nearestStop?.id ? (
                    <Text style={{ color: '#0057A8', fontSize: 11, marginTop: 2 }}>Sua parada mais próxima</Text>
                  ) : null}
                </View>
                {stop.nextBus ? (
                  <Text style={{ color: '#22c55e', fontSize: 13, fontWeight: '700' }}>
                    {formatArrivalTime(getMinutesUntil(stop.nextBus))}
                  </Text>
                ) : null}
              </View>
            ))}

            <Text style={styles.scheduleTitle}>Horários</Text>
            {/* FIX 1: feedback quando não há horários */}
            {(selectedLine?.schedules ?? []).length === 0 ? (
              <View style={styles.noScheduleWrap}>
                <MaterialCommunityIcons name="clock-outline" size={24} color="#CCCCCC" />
                <Text style={styles.noScheduleWrapText}>Nenhum horário cadastrado para esta linha</Text>
              </View>
            ) : (
              <View style={styles.scheduleGrid}>
                {(selectedLine?.schedules ?? []).map((time, idx) => (
                  <View
                    key={`sched-${idx}`}
                    style={[styles.scheduleCell, selectedNext === time && styles.scheduleCellNext]}
                  >
                    <Text style={[styles.scheduleCellText, selectedNext === time && styles.scheduleCellNextText]}>
                      {time}
                    </Text>
                  </View>
                ))}
              </View>
            )}

            <View style={styles.buttonsRow}>
              <TouchableOpacity
                style={styles.primaryBtn}
                onPress={() => {
                  const destination = selectedLine?.destination || 'Destino';
                  closeModal();
                  router.push({ pathname: '/route-plan', params: { destination } });
                }}
                accessibilityRole="button"
                accessibilityLabel="Traçar rota até o destino desta linha"
              >
                <Text style={styles.primaryBtnText}>Traçar rota</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={styles.secondaryBtn}
                onPress={() => selectedLine && toggleFavorite(selectedLine.id)}
                accessibilityRole="button"
                accessibilityLabel={selectedIsFavorite ? 'Remover dos favoritos' : 'Adicionar aos favoritos'}
              >
                <MaterialCommunityIcons
                  name={selectedIsFavorite ? 'heart' : 'heart-outline'}
                  size={20}
                  color="#0057A8"
                />
              </TouchableOpacity>
            </View>
          </ScrollView>
        </Animated.View>
      </Modal>
    </SafeAreaView>
  );
}

const recentStyles = StyleSheet.create({
  wrapper: {
    backgroundColor: '#FFFFFF',
    paddingTop: 16,
    paddingBottom: 0,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  title: {
    color: '#999999',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    textTransform: 'uppercase',
    paddingHorizontal: 20,
    marginBottom: 8,
  },
});

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  header: { backgroundColor: '#FFFFFF', paddingHorizontal: 20, paddingBottom: 16 },
  headerTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  title: { color: '#1E1D1D', fontSize: 22, fontWeight: '800' },
  demoBadge: { backgroundColor: '#F59E0B', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 4 },
  demoBadgeText: { color: '#FFFFFF', fontSize: 11, fontWeight: '700' },
  searchBar: { backgroundColor: '#F5F5F5', borderRadius: 16, height: 48, marginTop: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  searchInput: { flex: 1, fontSize: 14, marginLeft: 8, color: '#1E1D1D' },
  tabsRow: { flexDirection: 'row', borderBottomWidth: 1, borderBottomColor: '#EEEEEE', backgroundColor: '#FFFFFF' },
  tabButton: { paddingHorizontal: 16, paddingTop: 12, alignItems: 'center' },
  tabText: { color: '#999999', fontSize: 13 },
  tabTextActive: { color: '#1E1D1D', fontWeight: '700' },
  tabIndicator: { marginTop: 10, width: 30, height: 3, borderRadius: 2, backgroundColor: 'transparent' },
  tabIndicatorActive: { backgroundColor: '#0057A8' },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#999999' },
  sectionContent: { paddingBottom: 24 },
  metroEmptyWrap: { padding: 20, alignItems: 'center' },
  metroEmptyText: { color: '#999999', fontSize: 13, marginTop: 8, textAlign: 'center' },
  lineItem: { backgroundColor: '#FFFFFF', paddingHorizontal: 20, paddingVertical: 14, borderBottomWidth: 1, borderBottomColor: '#F5F5F5', flexDirection: 'row', alignItems: 'center' },
  lineCodeBadge: {
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 8,
    paddingTop: 3,
    paddingBottom: 5,
    alignItems: 'center',
    overflow: 'hidden',
    position: 'relative',
  },
  lineCodeRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  lineCodeBottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3 },
  lineCodeText: { color: '#1E1D1D', fontSize: 11, fontWeight: '700' },
  lineMain: { flex: 1, marginLeft: 12 },
  lineTitleRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'flex-start', gap: 6 },
  lineName: { color: '#1E1D1D', fontSize: 14, fontWeight: '500' },
  lineVia: { color: '#999999', fontSize: 12 },
  nextBusText: { color: '#22c55e', fontSize: 12, marginTop: 1, fontWeight: '600' },
  // FIX 1: novo estilo para sem horários
  noScheduleText: { color: '#CCCCCC', fontSize: 12, marginTop: 1 },
  modalOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    maxHeight: '88%',
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 32,
    borderTopRightRadius: 32,
    padding: 24,
    paddingBottom: 0,
  },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E0E0E0', alignSelf: 'center', marginBottom: 20 },
  sheetTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  sheetCodeBadge: {
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 8,
    paddingTop: 3,
    paddingBottom: 5,
    overflow: 'hidden',
    position: 'relative',
  },
  sheetCodeBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  sheetCodeBottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3 },
  sheetCodeText: { color: '#1E1D1D', fontSize: 11, fontWeight: '700' },
  sheetName: { color: '#1E1D1D', fontSize: 20, fontWeight: '700', marginTop: 8 },
  routeRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12, gap: 6 },
  routeText: { color: '#666666', fontSize: 14 },
  viaRow: { flexDirection: 'row', alignItems: 'center', marginTop: 6, gap: 6 },
  viaText: { color: '#999999', fontSize: 13 },
  badgesRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 },
  badgeOk: { backgroundColor: '#DCFCE7', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeOkText: { color: '#16A34A', fontSize: 12 },
  badgeNo: { backgroundColor: '#FEE2E2', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeNoText: { color: '#EF4444', fontSize: 12 },
  badgeOperator: { backgroundColor: '#F5F5F5', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeOperatorText: { color: '#666666', fontSize: 12 },
  badgeNext: { backgroundColor: '#EBF3FF', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeNextText: { color: '#0057A8', fontSize: 12, fontWeight: '600' },
  // FIX 1: badge de sem horários
  badgeNoSchedule: { backgroundColor: '#F5F5F5', borderRadius: 8, paddingHorizontal: 8, paddingVertical: 3 },
  badgeNoScheduleText: { color: '#AAAAAA', fontSize: 12 },
  scheduleTitle: { marginTop: 14, color: '#1E1D1D', fontSize: 15, fontWeight: '700' },
  scheduleGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 8 },
  scheduleCell: { width: '22%', backgroundColor: '#F5F5F5', borderRadius: 8, paddingVertical: 8, margin: 4, alignItems: 'center' },
  scheduleCellNext: { backgroundColor: '#EBF3FF' },
  scheduleCellText: { color: '#1E1D1D', fontSize: 13, textAlign: 'center' },
  scheduleCellNextText: { color: '#0057A8', fontWeight: '700' },
  // FIX 1: empty state de horários
  noScheduleWrap: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 16 },
  noScheduleWrapText: { color: '#AAAAAA', fontSize: 13 },
  buttonsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  primaryBtn: { flex: 1, height: 52, borderRadius: 40, backgroundColor: '#0057A8', alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700' },
  secondaryBtn: { width: 52, height: 52, borderRadius: 40, borderWidth: 1, borderColor: '#0057A8', marginLeft: 12, alignItems: 'center', justifyContent: 'center' },
});