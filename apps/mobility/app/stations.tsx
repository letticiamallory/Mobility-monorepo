import { MaterialCommunityIcons } from '@expo/vector-icons';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Dimensions,
  Image,
  Modal,
  SafeAreaView,
  SectionList,
  StyleSheet,
  TouchableOpacity,
  View
} from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import { ScaledText as Text } from '@/components/ScaledText';
import { useAccessibilitySurfaces } from '@/contexts/accessibility-preferences';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { API_URL } from '../constants/api';
import { MOCK_LINES } from '../mocks/lines';
import type { Station } from '../mocks/stations';
import { normalizeNextBusFromApi } from '../utils/schedule-time';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');
const MAP_CENTER = { latitude: -16.7167, longitude: -43.8647 };

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

const calculateDistance = (lat1: number, lng1: number, lat2: number, lng2: number): string => {
  const R = 6371000;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  const dist = R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return dist < 1000 ? `${Math.round(dist)}m` : `${(dist / 1000).toFixed(1)}km`;
};

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
  if (target.getTime() < now.getTime()) {
    target.setDate(target.getDate() + 1);
  }

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

const getArrivalStatus = (nextBus: string | null, distanceNum: number) => {
  if (!nextBus) return null;
  const [h, m] = nextBus.split(':').map(Number);
  if (Number.isNaN(h) || Number.isNaN(m)) return null;

  const minutesUntilBus = getMinutesUntil(nextBus);
  const walkMinutes = distanceNum / 80;

  if (walkMinutes <= minutesUntilBus) return { status: 'ok', label: 'Você chegará a tempo', color: '#22c55e' };
  return { status: 'late', label: 'Pode não chegar a tempo', color: '#F59E0B' };
};

const getLineName = (code: string): string => {
  const line = MOCK_LINES.find((l) => l.code === code);
  return line ? `${line.origin} → ${line.destination}` : code;
};

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
      /** API pode omitir; só tratar como não acessível quando vier explicitamente false */
      accessible: row.accessible !== false,
      lines: Array.isArray(row.lines) ? row.lines.map((line) => String(line)) : [],
      nextBus: normalizeNextBusFromApi(row.nextBus ?? row.next_bus),
      lat: typeof row.lat === 'number' ? row.lat : typeof row.latitude === 'number' ? row.latitude : MAP_CENTER.latitude,
      lng: typeof row.lng === 'number' ? row.lng : typeof row.longitude === 'number' ? row.longitude : MAP_CENTER.longitude,
    };
  });
}

export default function StationsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ tab?: string | string[] }>();
  const initialTab = (Array.isArray(params.tab) ? params.tab[0] : params.tab) === 'favorites'
    ? 'favorites'
    : 'all';
  const insets = useSafeAreaInsets();
  const sx = useAccessibilitySurfaces();
  const mapRef = useRef<MapView | null>(null);
  const sheetAnim = useRef(new Animated.Value(0)).current;

  const [loading, setLoading] = useState(true);

  const [stations, setStations] = useState<Station[]>([]);
  const [filtered, setFiltered] = useState<Station[]>([]);
  const [selectedTab, setSelectedTab] = useState<'all' | 'favorites'>(initialTab);
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [favorites, setFavorites] = useState<string[]>([]);
  /** true se a requisição falhou (rede, API fora do ar, etc.) */
  const [stationsFetchError, setStationsFetchError] = useState(false);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [stationPhotos, setStationPhotos] = useState<Record<string, string>>({});
  const [photoErrors, setPhotoErrors] = useState<Record<string, boolean>>({});
  const [sheetPhotoError, setSheetPhotoError] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const toastAnim = useRef(new Animated.Value(0)).current;

  const sheetTranslateY = sheetAnim.interpolate({
    inputRange: [0, 1],
    outputRange: [SCREEN_HEIGHT, 0],
  });

  useEffect(() => {
    void AsyncStorage.getItem('favorite_stations').then((data) => {
      if (!data?.trim()) return;
      try {
        const parsed = JSON.parse(data) as unknown;
        if (Array.isArray(parsed) && parsed.every((x) => typeof x === 'string')) {
          setFavorites(parsed);
        }
      } catch {
        void AsyncStorage.removeItem('favorite_stations');
      }
    });
  }, []);

  useEffect(() => {
    const load = async () => {
      let lat = MAP_CENTER.latitude;
      let lng = MAP_CENTER.longitude;
      try {
        setLoading(true);

        const permission = await Location.requestForegroundPermissionsAsync();
        if (permission.status === 'granted') {
          const current = await Location.getCurrentPositionAsync({});
          lat = current.coords.latitude;
          lng = current.coords.longitude;
          setUserLocation({ latitude: lat, longitude: lng });
        } else {
          setUserLocation(null);
        }

        const response = await fetch(`${API_URL}/stations/nearby?lat=${lat}&lng=${lng}`);
        const data = response.ok ? ((await response.json()) as unknown) : [];
        const parsed = parseStations(data);
        const apiFailed = !response.ok;
        setStationsFetchError(apiFailed);
        setStations(parsed);
      } catch {
        setStationsFetchError(true);
        setStations([]);
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const fetchStationPhoto = async (station: Station) => {
    try {
      const apiKey = process.env.EXPO_PUBLIC_GOOGLE_API_KEY;
      const searchUrl = `https://maps.googleapis.com/maps/api/place/findplacefromtext/json?input=${encodeURIComponent(station.name + ' Montes Claros')}&inputtype=textquery&fields=photos,place_id&key=${apiKey}`;
      const searchRes = await fetch(searchUrl);
      const searchData = await searchRes.json();

      const photoRef = searchData.candidates?.[0]?.photos?.[0]?.photo_reference as string | undefined;
      if (photoRef) {
        const photoUrl = `https://maps.googleapis.com/maps/api/place/photo?maxwidth=400&photo_reference=${photoRef}&key=${apiKey}`;
        setStationPhotos((prev) => ({ ...prev, [station.id]: photoUrl }));
      } else {
        const svUrl = `https://maps.googleapis.com/maps/api/streetview?size=400x200&location=${station.lat},${station.lng}&pitch=-15&fov=80&key=${apiKey}`;
        setStationPhotos((prev) => ({ ...prev, [station.id]: svUrl }));
      }
    } catch {
      // sem foto
    }
  };

  useEffect(() => {
    stations.forEach((s) => {
      if (!stationPhotos[s.id]) {
        fetchStationPhoto(s);
      }
    });
  }, [stations]);

  useEffect(() => {
    let next = [...stations];
    if (selectedTab === 'favorites') {
      next = next.filter((station) => favorites.includes(station.id));
    }
    next = [...next].sort((a, b) => {
      if (!userLocation) return a.distanceNum - b.distanceNum;
      return (
        calculateDistanceNum(userLocation.latitude, userLocation.longitude, a.lat, a.lng) -
        calculateDistanceNum(userLocation.latitude, userLocation.longitude, b.lat, b.lng)
      );
    });
    setFiltered(next);
  }, [stations, selectedTab, favorites, userLocation]);

  const showToast = (message: string) => {
    setToast(message);
    Animated.sequence([
      Animated.timing(toastAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
      Animated.delay(2000),
      Animated.timing(toastAnim, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => setToast(null));
  };

  const toggleFavorite = async (id: string) => {
    const isAdding = !favorites.includes(id);
    const newFavs = isAdding ? [...favorites, id] : favorites.filter((f) => f !== id);
    setFavorites(newFavs);
    await AsyncStorage.setItem('favorite_stations', JSON.stringify(newFavs));
    showToast(isAdding ? 'Estação adicionada aos favoritos ⭐' : 'Estação removida dos favoritos');
  };

  const openSheet = (station: Station) => {
    setSheetPhotoError(false);
    setSelectedStation(station);
    mapRef.current?.animateToRegion(
      {
        latitude: station.lat,
        longitude: station.lng,
        latitudeDelta: 0.02,
        longitudeDelta: 0.02,
      },
      400,
    );
    Animated.spring(sheetAnim, {
      toValue: 1,
      useNativeDriver: true,
      friction: 8,
      tension: 70,
    }).start();
  };

  const closeSheet = () => {
    Animated.timing(sheetAnim, {
      toValue: 0,
      duration: 180,
      useNativeDriver: true,
    }).start(() => setSelectedStation(null));
  };

  const stationSchedules = useMemo(() => {
    if (!selectedStation?.nextBus) return ['Sem horário previsto'];
    return [
      selectedStation.nextBus,
      '10:10',
      '10:40',
      '11:10',
      '11:40',
      '12:10',
      '12:40',
      '13:10',
    ];
  }, [selectedStation]);

  const nearestAccessibleStation = useMemo(() => {
    if (!userLocation || stations.length === 0) return [];

    const sorted = [...stations].sort((a, b) =>
      calculateDistanceNum(userLocation.latitude, userLocation.longitude, a.lat, a.lng) -
      calculateDistanceNum(userLocation.latitude, userLocation.longitude, b.lat, b.lng),
    );

    const nearestAccessible = sorted.find((s) => s.accessible) ?? sorted[0];
    return nearestAccessible ? [nearestAccessible] : [];
  }, [stations, userLocation]);

  return (
    <SafeAreaView style={[styles.container, sx.fillScreen]}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={[styles.header, sx.fillCard, { paddingTop: insets.top + 12 }]}>
        <View style={styles.headerTop}>
          <Text style={styles.title}>Estações</Text>
        </View>
        <TouchableOpacity
          style={[styles.searchBar, sx.searchInset]}
          onPress={() => router.push('/search-destination')}
          activeOpacity={0.7}
          accessibilityRole="button"
          accessibilityLabel="Buscar estação"
          accessibilityHint="Abre a busca de destino para encontrar uma estação"
        >
          <MaterialCommunityIcons name="magnify" size={20} color="#AAAAAA" />
          <Text style={[styles.searchInput, { color: '#AAAAAA', paddingTop: 2 }]} importantForAccessibility="no">
            Buscar estação...
          </Text>
        </TouchableOpacity>
      </View>

      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={{
          latitude: MAP_CENTER.latitude,
          longitude: MAP_CENTER.longitude,
          latitudeDelta: 0.05,
          longitudeDelta: 0.05,
        }}
      >
        {userLocation ? <Marker coordinate={userLocation} pinColor="#0057A8" /> : null}
        {filtered.map((station) => (
          <Marker
            key={station.id}
            coordinate={{ latitude: station.lat, longitude: station.lng }}
            onPress={() => openSheet(station)}
          >
            <View
              style={[
                styles.stationPin,
                {
                  backgroundColor:
                    selectedStation?.id === station.id ? '#0057A8' : station.accessible ? '#0057A8' : '#999999',
                },
              ]}
            >
              <MaterialCommunityIcons name="bus" size={14} color="#FFFFFF" />
            </View>
          </Marker>
        ))}
      </MapView>

      <View style={[styles.tabsRow, sx.fillCard, sx.hairlineBottom]}>
        <TouchableOpacity
          style={styles.tabButton}
          onPress={() => setSelectedTab('all')}
          accessibilityRole="button"
          accessibilityLabel="Todas as estações"
          accessibilityState={{ selected: selectedTab === 'all' }}
        >
          <Text style={[styles.tabText, selectedTab === 'all' && styles.tabTextActive]}>Todos</Text>
          <View style={[styles.tabLine, selectedTab === 'all' && styles.tabLineActive]} />
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.tabButton}
          onPress={() => setSelectedTab('favorites')}
          accessibilityRole="button"
          accessibilityLabel="Estações favoritas"
          accessibilityState={{ selected: selectedTab === 'favorites' }}
        >
          <Text style={[styles.tabText, selectedTab === 'favorites' && styles.tabTextActive]}>Favoritas</Text>
          <View style={[styles.tabLine, selectedTab === 'favorites' && styles.tabLineActive]} />
        </TouchableOpacity>
      </View>

      {loading ? (
        <View style={styles.centerWrap}>
          <Text style={styles.emptyText}>Carregando estações...</Text>
        </View>
      ) : (
        <SectionList
          ListEmptyComponent={
            <View style={styles.centerWrap}>
              <MaterialCommunityIcons name="bus-stop" size={40} color="#CCCCCC" />
              <Text style={[styles.emptyText, { marginTop: 12, textAlign: 'center', paddingHorizontal: 24 }]}>
                {stationsFetchError
                  ? 'Não foi possível carregar as estações. Verifique a internet e se a API está no ar.'
                  : 'Nenhuma parada encontrada nesta região. Tente outro local ou aumente a cobertura no backend.'}
              </Text>
            </View>
          }
          ListHeaderComponent={selectedTab !== 'all' ? null : (
            <View style={{ paddingHorizontal: 16, paddingTop: 8, paddingBottom: 4 }}>
              {nearestAccessibleStation
                .slice(0, 1)
                .map((station) => (
                <View
                  key={station.id}
                  style={[
                    {
                      marginBottom: 8,
                      marginTop: 4,
                      borderRadius: 16,
                      overflow: 'hidden',
                      shadowColor: '#000',
                      shadowOpacity: 0.08,
                      shadowRadius: 8,
                      elevation: 3,
                      borderWidth: 1.5,
                      borderColor: station.accessible ? '#22c55e' : '#CCCCCC',
                    },
                    sx.fillCard,
                  ]}
                >
                  <View
                    style={{
                      backgroundColor: station.accessible ? '#22c55e' : '#999999',
                      paddingHorizontal: 14,
                      paddingVertical: 6,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 6,
                    }}
                  >
                    <MaterialCommunityIcons name="map-marker-radius" size={14} color="#FFFFFF" />
                    <Text style={{ color: '#FFFFFF', fontSize: 12, fontWeight: '700' }}>
                      {station.accessible ? 'Opção acessível mais próxima' : '2ª estação mais próxima'}
                    </Text>
                  </View>

                  <View style={{ padding: 12 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                      <View style={{ flex: 1, paddingRight: 8 }}>
                        <Text style={{ color: '#1E1D1D', fontSize: 15, fontWeight: '700' }}>{station.name}</Text>
                        <Text style={{ color: '#999999', fontSize: 12, marginTop: 2 }}>{station.address}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 6 }}>
                          <MaterialCommunityIcons name="walk" size={13} color="#0057A8" />
                          <Text style={{ color: '#0057A8', fontSize: 12, fontWeight: '600' }}>
                            {userLocation
                              ? calculateDistance(userLocation.latitude, userLocation.longitude, station.lat, station.lng)
                              : station.distance}
                            {' • '}
                            {userLocation
                              ? getWalkTime(
                                  calculateDistanceNum(
                                    userLocation.latitude,
                                    userLocation.longitude,
                                    station.lat,
                                    station.lng,
                                  ),
                                )
                              : ''}
                          </Text>
                        </View>
                      </View>
                      {stationPhotos[station.id] && (
                        <Image
                          source={{ uri: stationPhotos[station.id] }}
                          style={{ width: 64, height: 64, borderRadius: 8 }}
                          resizeMode="cover"
                        />
                      )}
                    </View>

                    <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginTop: 6 }}>
                      <View style={{ alignItems: 'flex-start', gap: 6 }}>
                        {station.accessible ? (
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 4,
                              backgroundColor: '#DCFCE7',
                              borderRadius: 6,
                              paddingHorizontal: 8,
                              paddingVertical: 3,
                            }}
                          >
                            <MaterialCommunityIcons name="wheelchair-accessibility" size={12} color="#16A34A" />
                            <Text style={{ color: '#16A34A', fontSize: 11, fontWeight: '600' }}>Acessível</Text>
                          </View>
                        ) : (
                          <View
                            style={{
                              flexDirection: 'row',
                              alignItems: 'center',
                              gap: 4,
                              backgroundColor: '#FEE2E2',
                              borderRadius: 6,
                              paddingHorizontal: 8,
                              paddingVertical: 3,
                            }}
                          >
                            <MaterialCommunityIcons name="wheelchair-accessibility" size={12} color="#EF4444" />
                            <Text style={{ color: '#EF4444', fontSize: 11, fontWeight: '600' }}>Não acessível</Text>
                          </View>
                        )}
                      </View>
                      {station.nextBus && (
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: '#22c55e', fontSize: 13, fontWeight: '700' }}>
                          Ônibus em {formatArrivalTime(getMinutesUntil(station.nextBus))}
                        </Text>
                        <Text style={{ color: '#999999', fontSize: 11 }}>{station.nextBus}</Text>
                      </View>
                      )}
                    </View>

                    <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: '#F0F0F0', paddingTop: 10, gap: 8 }}>
                      {station.lines.map((lineCode, index) => {
                        const baseMinutes = station.nextBus ? Math.round(getMinutesUntil(station.nextBus)) : null;
                        const lineMinutes = baseMinutes !== null ? baseMinutes + (index * 7) : null;
                        const lineTime = station.nextBus ? (() => {
                          const [h, m] = station.nextBus.split(':').map(Number);
                          const d = new Date();
                          d.setHours(h, m + (index * 7), 0);
                          return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                        })() : null;

                        return (
                          <View key={`nearest-arrival-${lineCode}`} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                            <View style={styles.stationLineCodeBadge}>
                              <View style={styles.stationLineCodeRow}>
                                <MaterialCommunityIcons
                                  name={station.type === 'subway' ? 'subway-variant' : 'bus'}
                                  size={11}
                                  color="#1E1D1D"
                                />
                                <Text style={styles.stationLineCodeText}>{lineCode}</Text>
                              </View>
                              <View
                                style={[
                                  styles.stationLineCodeBottomBar,
                                  { backgroundColor: getLineColor(lineCode) },
                                ]}
                              />
                            </View>

                            <Text style={{ flex: 1, color: '#666666', fontSize: 12, marginHorizontal: 10 }} numberOfLines={1}>
                              {getLineName(lineCode)}
                            </Text>

                            {lineMinutes !== null ? (
                              <View style={{ alignItems: 'flex-end' }}>
                                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                                  <MaterialCommunityIcons name="wifi" size={12} color="#22c55e" />
                                  <Text style={{ color: '#22c55e', fontSize: 15, fontWeight: '800' }}>{formatArrivalTime(lineMinutes)}</Text>
                                </View>
                                <Text style={{ color: '#999999', fontSize: 10 }}>{lineTime}</Text>
                              </View>
                            ) : (
                              <Text style={{ color: '#CCCCCC', fontSize: 12 }}>--</Text>
                            )}
                          </View>
                        );
                      })}
                    </View>
                  </View>
                </View>
              ))}
            </View>
          )}
          sections={[
            {
              title: 'Metrô',
              type: 'metro' as const,
              icon: 'subway-variant' as const,
              data: filtered.filter((s) => s.type === 'subway'),
            },
            {
              title: 'Ônibus',
              type: 'bus' as const,
              icon: 'bus' as const,
              data: filtered.filter((s) => s.type === 'bus' && s.id !== nearestAccessibleStation[0]?.id),
            },
          ]}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderSectionHeader={({ section }) => (
            <View
              style={[
                {
                  flexDirection: 'row',
                  alignItems: 'center',
                  paddingHorizontal: 16,
                  paddingVertical: 12,
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
                  Nenhuma estação de metrô{'\n'}encontrada na sua região
                </Text>
              </View>
            ) : null
          }
          renderItem={({ item, index, section }) => (
            <TouchableOpacity
              style={[
                styles.card,
                sx.fillCard,
                section.type === 'bus' && index === 0 ? { marginTop: 8 } : null,
              ]}
              onPress={() => openSheet(item)}
              accessibilityRole="button"
              accessibilityLabel={`Estação ${item.name}. ${item.address}. ${item.accessible ? 'Acessível' : 'Pode não ser acessível'}`}
              accessibilityHint="Abre detalhes e horários desta estação"
            >
              <View style={styles.cardRow}>
                <View style={styles.cardMain}>
                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <View style={{ flex: 1, paddingRight: 8 }}>
                      <Text style={styles.cardTitle}>{item.name}</Text>
                      <Text style={styles.cardAddress}>{item.address}</Text>
                      <View style={styles.walkInfoRow}>
                        <MaterialCommunityIcons name="walk" size={13} color="#0057A8" />
                        <Text style={styles.walkInfoText}>
                          {userLocation
                            ? calculateDistance(
                                userLocation.latitude,
                                userLocation.longitude,
                                item.lat,
                                item.lng,
                              )
                            : item.distance}
                          {' • '}
                          {userLocation
                            ? getWalkTime(
                                calculateDistanceNum(
                                  userLocation.latitude,
                                  userLocation.longitude,
                                  item.lat,
                                  item.lng,
                                ),
                              )
                            : ''}
                        </Text>
                      </View>
                    </View>
                    {!photoErrors[item.id] && stationPhotos[item.id] ? (
                      <Image
                        source={{ uri: stationPhotos[item.id] }}
                        style={{ width: 64, height: 64, borderRadius: 8 }}
                        resizeMode="cover"
                        onError={() =>
                          setPhotoErrors((prev) => ({
                            ...prev,
                            [item.id]: true,
                          }))
                        }
                      />
                    ) : null}
                  </View>

                  <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', marginTop: 6 }}>
                    <View style={{ alignItems: 'flex-start', gap: 6 }}>
                      {item.accessible ? (
                        <View style={styles.accessibleBadge}>
                          <MaterialCommunityIcons
                            name="wheelchair-accessibility"
                            size={12}
                            color="#16A34A"
                          />
                          <Text style={styles.accessibleBadgeText}>Acessível</Text>
                        </View>
                      ) : (
                        <View style={styles.notAccessibleBadge}>
                          <MaterialCommunityIcons
                            name="wheelchair-accessibility"
                            size={12}
                            color="#EF4444"
                          />
                          <Text style={styles.notAccessibleBadgeText}>Não acessível</Text>
                        </View>
                      )}
                    </View>
                    {item.nextBus ? (
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: '#22c55e', fontSize: 13, fontWeight: '700' }}>
                          Ônibus em {formatArrivalTime(getMinutesUntil(item.nextBus))}
                        </Text>
                        <Text style={{ color: '#999999', fontSize: 11 }}>{item.nextBus}</Text>
                      </View>
                    ) : null}
                  </View>

                  <View style={{ marginTop: 10, borderTopWidth: 1, borderTopColor: '#F0F0F0', paddingTop: 10, gap: 8 }}>
                    {item.lines.map((lineCode, index) => {
                      const baseMinutes = item.nextBus ? Math.round(getMinutesUntil(item.nextBus)) : null;
                      const lineMinutes = baseMinutes !== null ? baseMinutes + (index * 7) : null;
                      const lineTime = item.nextBus ? (() => {
                        const [h, m] = item.nextBus.split(':').map(Number);
                        const d = new Date();
                        d.setHours(h, m + (index * 7), 0);
                        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
                      })() : null;

                      return (
                        <View key={`card-arrival-${item.id}-${lineCode}`} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                          <View style={styles.stationLineCodeBadge}>
                            <View style={styles.stationLineCodeRow}>
                              <MaterialCommunityIcons
                                name={item.type === 'subway' ? 'subway-variant' : 'bus'}
                                size={11}
                                color="#1E1D1D"
                              />
                              <Text style={styles.stationLineCodeText}>{lineCode}</Text>
                            </View>
                            <View
                              style={[
                                styles.stationLineCodeBottomBar,
                                { backgroundColor: getLineColor(lineCode) },
                              ]}
                            />
                          </View>

                          <Text style={{ flex: 1, color: '#666666', fontSize: 12, marginHorizontal: 10 }} numberOfLines={1}>
                            {getLineName(lineCode)}
                          </Text>

                          {lineMinutes !== null ? (
                            <View style={{ alignItems: 'flex-end' }}>
                              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                                <MaterialCommunityIcons name="wifi" size={12} color="#22c55e" />
                                <Text style={{ color: '#22c55e', fontSize: 15, fontWeight: '800' }}>{formatArrivalTime(lineMinutes)}</Text>
                              </View>
                              <Text style={{ color: '#999999', fontSize: 10 }}>{lineTime}</Text>
                            </View>
                          ) : (
                            <Text style={{ color: '#CCCCCC', fontSize: 12 }}>--</Text>
                          )}
                        </View>
                      );
                    })}
                  </View>
                </View>
              </View>
            </TouchableOpacity>
          )}
        />
      )}

      <Modal visible={!!selectedStation} transparent animationType="slide" onRequestClose={closeSheet}>
        <TouchableOpacity
          style={styles.modalOverlay}
          onPress={closeSheet}
          activeOpacity={1}
          accessibilityRole="button"
          accessibilityLabel="Fechar detalhes da estação"
        />
        <Animated.View style={[styles.sheet, sx.fillCard, { transform: [{ translateY: sheetTranslateY }] }]}>
          <View style={styles.handle} />
          <Text style={styles.sheetTitle}>{selectedStation?.name}</Text>
          <Text style={styles.sheetAddress}>{selectedStation?.address}</Text>

          {!sheetPhotoError && selectedStation ? (
            <View style={styles.sheetPhotoContainer}>
              <Image
                source={{ uri: stationPhotos[selectedStation.id] }}
                style={styles.sheetPhoto}
                resizeMode="cover"
                onError={() => setSheetPhotoError(true)}
              />
            </View>
          ) : null}

          {selectedStation ? (
            <MapView
              style={styles.sheetMap}
              initialRegion={{
                latitude: selectedStation.lat,
                longitude: selectedStation.lng,
                latitudeDelta: 0.01,
                longitudeDelta: 0.01,
              }}
            >
              <Marker coordinate={{ latitude: selectedStation.lat, longitude: selectedStation.lng }} />
            </MapView>
          ) : null}

          <Text style={styles.arrivalsTitle}>Próximas chegadas</Text>
          {selectedStation?.lines
            .filter((lineCode) => {
              const distanceNum = userLocation
                ? calculateDistanceNum(
                    userLocation.latitude,
                    userLocation.longitude,
                    selectedStation.lat,
                    selectedStation.lng,
                  )
                : selectedStation.distanceNum;
              const arrivalStatus = getArrivalStatus(selectedStation.nextBus, distanceNum);
              return arrivalStatus?.status === 'ok';
            })
            .map((lineCode) => {
            const distanceNum = userLocation
              ? calculateDistanceNum(
                  userLocation.latitude,
                  userLocation.longitude,
                  selectedStation.lat,
                  selectedStation.lng,
                )
              : selectedStation.distanceNum;
            const arrivalStatus = getArrivalStatus(selectedStation.nextBus, distanceNum);
            return (
              <View key={`arrival-${lineCode}`} style={styles.arrivalWrap}>
                <View style={styles.arrivalRow}>
                  <View style={styles.arrivalBadge}>
                    <View style={styles.arrivalBadgeRow}>
                      <MaterialCommunityIcons
                        name={selectedStation.type === 'subway' ? 'subway-variant' : 'bus'}
                        size={11}
                        color="#1E1D1D"
                      />
                      <Text style={styles.arrivalBadgeText}>{lineCode}</Text>
                    </View>
                    <View
                      style={[
                        styles.arrivalBadgeBottom,
                        { backgroundColor: getLineColor(lineCode) },
                      ]}
                    />
                  </View>

                  <Text style={styles.arrivalLineName} numberOfLines={2}>
                    {getLineName(lineCode)}
                  </Text>

                  <View style={styles.arrivalRight}>
                    <Text style={styles.arrivalMinutes}>
                      {selectedStation.nextBus
                        ? formatArrivalTime(getMinutesUntil(selectedStation.nextBus))
                        : '--'}
                    </Text>
                    <Text style={styles.arrivalClock}>{selectedStation.nextBus ?? ''}</Text>
                  </View>
                </View>

                {arrivalStatus ? (
                  <Text style={[styles.arrivalStatusText, { color: arrivalStatus.color }]}>
                    {arrivalStatus.label}
                  </Text>
                ) : null}
              </View>
            );
          })}

          <View style={styles.scheduleGrid}>
            {stationSchedules.map((time, idx) => (
              <View key={`${time}-${idx}`} style={styles.scheduleCell}>
                <Text style={styles.scheduleCellText}>{time}</Text>
              </View>
            ))}
          </View>

          <View style={styles.buttonsRow}>
            <TouchableOpacity
              style={styles.secondaryBtn}
              onPress={() => selectedStation && toggleFavorite(selectedStation.id)}
              accessibilityRole="button"
              accessibilityLabel={
                selectedStation && favorites.includes(selectedStation.id)
                  ? 'Remover estação dos favoritos'
                  : 'Adicionar estação aos favoritos'
              }
            >
              <Text style={styles.secondaryBtnText}>
                {selectedStation && favorites.includes(selectedStation.id) ? 'Desfavoritar' : 'Favoritar'}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.primaryBtn}
              onPress={() => {
                if (!selectedStation) return;
                closeSheet();
                router.push({ pathname: '/route-plan', params: { destination: selectedStation.name } });
              }}
              accessibilityRole="button"
              accessibilityLabel="Como chegar nesta estação"
            >
              <Text style={styles.primaryBtnText}>Como chegar</Text>
            </TouchableOpacity>
          </View>

          {toast ? (
            <Animated.View
              style={{
                position: 'absolute',
                top: 16,
                left: 24,
                right: 24,
                backgroundColor: '#0057A8',
                borderRadius: 14,
                paddingVertical: 12,
                paddingHorizontal: 20,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 8,
                opacity: toastAnim,
                transform: [{ translateY: toastAnim.interpolate({ inputRange: [0, 1], outputRange: [-8, 0] }) }],
                shadowColor: '#0057A8',
                shadowOpacity: 0.3,
                shadowRadius: 8,
                elevation: 10,
                zIndex: 999,
              }}
            >
              <MaterialCommunityIcons name="check-circle" size={16} color="#FFFFFF" />
              <Text style={{ color: '#FFFFFF', fontSize: 14, fontWeight: '600' }}>{toast}</Text>
            </Animated.View>
          ) : null}
        </Animated.View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F5F5F5' },
  header: { backgroundColor: '#FFFFFF', paddingHorizontal: 20, paddingBottom: 12 },
  headerTop: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  title: { color: '#1E1D1D', fontSize: 22, fontWeight: '800' },
  searchBar: { backgroundColor: '#F5F5F5', borderRadius: 14, height: 44, marginTop: 12, flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16 },
  searchInput: { flex: 1, marginLeft: 8, color: '#1E1D1D', fontSize: 14 },
  map: { height: 220, width: '100%' },
  stationPin: { borderRadius: 20, padding: 6, borderWidth: 2, borderColor: '#FFFFFF' },
  tabsRow: { flexDirection: 'row', backgroundColor: '#FFFFFF', borderBottomWidth: 1, borderBottomColor: '#EEEEEE' },
  tabButton: { paddingHorizontal: 20, paddingTop: 10, alignItems: 'center' },
  tabText: { color: '#999999', fontSize: 13 },
  tabTextActive: { color: '#1E1D1D', fontWeight: '700' },
  tabLine: { marginTop: 8, width: 32, height: 3, backgroundColor: 'transparent', borderRadius: 2 },
  tabLineActive: { backgroundColor: '#0057A8' },
  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  emptyText: { color: '#999999' },
  listContent: { paddingBottom: 24 },
  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#F5F5F5',
  },
  sectionHeaderLeft: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  sectionHeaderTitle: { color: '#666666', fontSize: 13, fontWeight: '600' },
  sectionHeaderCount: { color: '#999999', fontSize: 12 },
  metroEmptyWrap: { padding: 20, alignItems: 'center' },
  metroEmptyText: { color: '#999999', fontSize: 13, marginTop: 8, textAlign: 'center' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 16, padding: 16, marginBottom: 12, marginHorizontal: 16, shadowColor: '#000', shadowOpacity: 0.06, shadowRadius: 8, elevation: 2 },
  sheetPhotoContainer: { backgroundColor: '#F5F5F5', borderRadius: 12, marginTop: 12, overflow: 'hidden' },
  sheetPhoto: { width: '100%', height: 180, borderRadius: 12 },
  cardRow: { flexDirection: 'row', alignItems: 'flex-start' },
  iconCircle: { width: 44, height: 44, backgroundColor: '#EBF3FF', borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  cardMain: { flex: 1, marginLeft: 12 },
  cardTitle: { color: '#1E1D1D', fontSize: 15, fontWeight: '700' },
  cardAddress: { color: '#999999', fontSize: 12, marginTop: 2 },
  walkInfoRow: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 4 },
  walkInfoText: { color: '#0057A8', fontSize: 12, fontWeight: '600' },
  accessBadgeRow: { marginTop: 8 },
  accessibleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#DCFCE7',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  accessibleBadgeText: { color: '#16A34A', fontSize: 11, fontWeight: '600' },
  notAccessibleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FEE2E2',
    borderRadius: 6,
    paddingHorizontal: 8,
    paddingVertical: 3,
    alignSelf: 'flex-start',
  },
  notAccessibleBadgeText: { color: '#EF4444', fontSize: 11, fontWeight: '600' },
  linesWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: 4, marginTop: 4 },
  lineChip: { backgroundColor: 'transparent', borderRadius: 6, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden', position: 'relative' },
  lineChipText: { color: '#1E1D1D', fontSize: 11, fontWeight: '600' },
  lineChipBottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 2.5 },
  nextText: { color: '#22c55e', fontSize: 12, marginTop: 6, fontWeight: '600' },
  cardRight: { alignItems: 'flex-end', marginLeft: 8 },
  favoriteBtn: { marginTop: 10 },
  modalOverlay: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.4)' },
  sheet: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: '#FFFFFF', borderTopLeftRadius: 32, borderTopRightRadius: 32, padding: 24, paddingBottom: 28 },
  handle: { width: 40, height: 4, borderRadius: 2, backgroundColor: '#E0E0E0', alignSelf: 'center', marginBottom: 20 },
  sheetTitle: { color: '#1E1D1D', fontSize: 18, fontWeight: '700' },
  sheetAddress: { color: '#666666', fontSize: 14, marginTop: 4 },
  sheetMap: { height: 120, borderRadius: 12, marginTop: 12 },
  sheetLinesWrap: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 12, gap: 8 },
  sheetLineChip: { backgroundColor: 'transparent', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6, overflow: 'hidden', position: 'relative' },
  sheetLineChipText: { color: '#1E1D1D', fontSize: 13, fontWeight: '700' },
  sheetLineChipBottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3 },
  arrivalsTitle: { color: '#1E1D1D', fontSize: 15, fontWeight: '700', marginTop: 14 },
  stationLineCodeBadge: {
    backgroundColor: '#FFFFFF',
    borderRadius: 6,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    paddingHorizontal: 8,
    paddingTop: 3,
    paddingBottom: 5,
    overflow: 'hidden',
    minWidth: 60,
    alignItems: 'center',
    position: 'relative',
  },
  stationLineCodeRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  stationLineCodeText: { color: '#1E1D1D', fontSize: 11, fontWeight: '700' },
  stationLineCodeBottomBar: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3 },
  arrivalWrap: { marginTop: 6 },
  arrivalRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  arrivalBadge: {
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
  arrivalBadgeRow: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  arrivalBadgeText: { color: '#1E1D1D', fontSize: 11, fontWeight: '700' },
  arrivalBadgeBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 3 },
  arrivalLineName: { flex: 1, color: '#1E1D1D', fontSize: 13, marginHorizontal: 12 },
  arrivalRight: { alignItems: 'flex-end' },
  arrivalMinutes: { color: '#22c55e', fontSize: 18, fontWeight: '800' },
  arrivalClock: { color: '#999999', fontSize: 11 },
  arrivalStatusText: { fontSize: 12, marginTop: 4, marginBottom: 8 },
  scheduleGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: 10 },
  scheduleCell: { width: '23%', backgroundColor: '#F5F5F5', borderRadius: 8, paddingVertical: 8, margin: 4, alignItems: 'center' },
  scheduleCellText: { color: '#1E1D1D', fontSize: 13 },
  buttonsRow: { flexDirection: 'row', alignItems: 'center', marginTop: 14 },
  primaryBtn: { flex: 1, height: 52, borderRadius: 40, backgroundColor: '#0057A8', alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#FFFFFF', fontWeight: '700' },
  secondaryBtn: { flex: 1, height: 52, marginRight: 12, borderRadius: 40, borderWidth: 1, borderColor: '#0057A8', alignItems: 'center', justifyContent: 'center' },
  secondaryBtnText: { color: '#0057A8', fontWeight: '700' },
});