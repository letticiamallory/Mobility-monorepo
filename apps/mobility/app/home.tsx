import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import * as Location from 'expo-location';
import {
  Alert,
  ImageBackground,
  Linking,
  ScrollView,
  StatusBar,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { ScaledText as PaperText } from '@/components/ScaledText';
import { ScaledTextInput as TextInput } from '@/components/ScaledTextInput';
import { useAccessibilityPreferences, useAccessibilitySurfaces } from '@/contexts/accessibility-preferences';
import { A11Y_HIT_SLOP } from '@/constants/accessibility';
import { SafeAreaView } from 'react-native-safe-area-context';
import {
  getHomeFavorites,
  PRESET_FAVORITE_IDS,
  removeHomeFavorite,
  type HomeFavoriteRow,
} from '../services/home-favorites.service';
import {
  fetchUserRouteHistory,
  sortRouteHistoryNewestFirst,
} from '../services/routes.service';
import { getToken, getUserInfo } from '../services/token.service';

const FAVORITE_EDIT_TITLES: Record<string, string> = {
  home: 'Definir endereço residencial',
  work: 'Definir endereço do trabalho',
  hospital: 'Definir endereço do hospital',
  school: 'Definir endereço da escola',
};

/** Endereço placeholder dos presets Hospital/Escola em favoritos antigos (sem `subtitle`). */
const PRESET_PLACEHOLDER_ADDRESS: Record<string, string> = {
  hospital: 'Hospital',
  school: 'Escola',
};

function isConfiguredFavorite(item: HomeFavoriteRow): boolean {
  const addr = (item.address ?? '').trim();
  if (!addr) return false;
  // Enquanto tiver "toque para editar", consideramos não configurado.
  if ((item.subtitle ?? '').trim()) return false;
  // Presets antigos podem ter address placeholder igual ao label (Casa/Trabalho/etc).
  const id = String(item.id).trim();
  const ph = PRESET_PLACEHOLDER_ADDRESS[id];
  if (ph && addr === ph) return false;
  if ((id === 'home' || id === 'work') && addr === item.label.trim()) return false;
  return Number.isFinite(item.lat) && Number.isFinite(item.lng);
}

function favoriteCardSubtitle(item: HomeFavoriteRow): string {
  const hint = item.subtitle?.trim();
  if (hint) return hint;
  const id = String(item.id).trim();
  const ph = PRESET_PLACEHOLDER_ADDRESS[id];
  if (ph && item.address.trim() === ph) return 'toque para editar';
  const addr = item.address ?? '';
  return addr.length > 36 ? `${addr.slice(0, 36)}…` : addr;
}

type RecentRoute = {
  id: string;
  origin: string;
  destination: string;
  originTitle?: string;
  destinationTitle?: string;
  originAddress?: string;
  destinationAddress?: string;
  accessible: boolean;
};

export default function HomeScreen() {
  const router = useRouter();
  const { highContrast } = useAccessibilityPreferences();
  const sx = useAccessibilitySurfaces();
  const [name, setName] = useState('');
  const [destination, setDestination] = useState('');
  const [recentRoutes, setRecentRoutes] = useState<RecentRoute[]>([]);
  const [loadingRecents, setLoadingRecents] = useState(true);
  const [userLocation, setUserLocation] = useState<Location.LocationObjectCoords | null>(null);
  const [favorites, setFavorites] = useState<HomeFavoriteRow[]>([]);

  const reloadFavorites = useCallback(async () => {
    setFavorites(await getHomeFavorites());
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
      const mapped = sorted.slice(0, 4).map((item) => ({
        id: String(item.id),
        origin: item.origin?.trim() || 'Origem',
        destination: item.destination?.trim() || 'Destino',
        originTitle: (item.originTitle ?? item.origin_title)?.trim() || undefined,
        destinationTitle: (item.destinationTitle ?? item.destination_title)?.trim() || undefined,
        originAddress: (item.originAddress ?? item.origin_address)?.trim() || undefined,
        destinationAddress: (item.destinationAddress ?? item.destination_address)?.trim() || undefined,
        accessible: item.accessible !== false,
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
      void reloadFavorites();
      void loadRecentRoutes();
    }, [reloadFavorites, loadRecentRoutes]),
  );

  useEffect(() => {
    const loadData = async () => {
      const userInfo = await getUserInfo();
      if (userInfo.name) setName(userInfo.name);
    };
    loadData();
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (cancelled || status !== Location.PermissionStatus.GRANTED) return;
        const loc = await Location.getCurrentPositionAsync({});
        if (!cancelled) setUserLocation(loc.coords);
      } catch {
        /* permissão negada, serviços desligados ou erro — home funciona sem GPS */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const goToDirections = (dest: string, origin?: string) => {
    // Evita tela vazia: `route-plan` pré-carrega e só então abre `route-results`.
    router.push({
      pathname: '/route-plan',
      params: {
        destination: dest,
        ...(origin ? { origin } : {}),
      },
    });
  };

  const goToRoutePlanFromRecent = (destination: string, origin: string) => {
    router.push({
      pathname: '/route-plan',
      params: {
        destination: destination.trim(),
        origin: origin.trim(),
      },
    });
  };

  const submitSearch = () => {
    goToDirections(destination.trim() || 'Destino');
  };

  const openUber = async () => {
    const uberDeepLink = `uber://?action=setPickup&pickup[latitude]=${userLocation?.latitude}&pickup[longitude]=${userLocation?.longitude}&pickup[nickname]=Minha%20localização`;
    const canOpen = await Linking.canOpenURL(uberDeepLink);

    if (canOpen) {
      await Linking.openURL(uberDeepLink);
    } else {
      await Linking.openURL('https://m.uber.com/looking');
    }
  };

  const hasRecents = recentRoutes.length > 0;

  const openFavoriteEditor = (item: HomeFavoriteRow) => {
    const screenTitle = PRESET_FAVORITE_IDS.has(String(item.id).trim())
      ? FAVORITE_EDIT_TITLES[item.id] ?? `Definir ${item.label}`
      : 'Editar favorito';
    router.push({
      pathname: '/search-destination',
      params: {
        favoriteFlow: '1',
        favoriteId: item.id,
        presetIcon: item.icon,
        screenTitle,
      },
    });
  };

  const openFavoriteRoutePlan = (item: HomeFavoriteRow) => {
    router.push({
      pathname: '/route-plan',
      params: {
        destination: item.address.trim(),
        destLat: String(item.lat),
        destLng: String(item.lng),
      },
    });
  };

  const openAddFavorite = () => {
    router.push({
      pathname: '/search-destination',
      params: {
        favoriteFlow: '1',
        favoriteAction: 'add',
        screenTitle: 'Adicionar aos favoritos',
      },
    });
  };

  const confirmRemoveFavorite = (item: HomeFavoriteRow) => {
    const title = 'Confirmar exclusão';
    const message = `Tem certeza de que deseja excluir “${item.label}” dos favoritos? Você pode adicionar de novo depois em Adicionar.`;
    Alert.alert(title, message, [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sim, excluir',
        style: 'destructive',
        onPress: () => {
          const idToRemove = item.id;
          void (async () => {
            try {
              const next = await removeHomeFavorite(idToRemove);
              setFavorites(next);
            } catch {
              await reloadFavorites();
            }
          })();
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={[styles.safeArea, sx.fillScreen]} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle={highContrast ? 'light-content' : 'dark-content'} />

      <ScrollView style={[styles.safeArea, sx.fillScreen]} contentContainerStyle={styles.content}>
        <ImageBackground source={require('../assets/images/city.jpg')} style={styles.header}>
          <View style={styles.headerOverlay} />
          <View style={styles.headerContent}>
            <PaperText style={styles.hello}>Olá, {name || 'Usuário'}!</PaperText>
            <PaperText style={styles.headerTitle}>Para onde você quer ir?</PaperText>

            <TouchableOpacity
              style={styles.searchWrap}
              onPress={() => router.push('/search-destination')}
              activeOpacity={0.9}
              accessibilityRole="button"
              accessibilityLabel="Buscar destino"
              accessibilityHint="Abre a busca para onde você quer ir"
            >
              <TextInput
                style={styles.searchInput}
                placeholder="Digite o destino..."
                placeholderTextColor="#9CA3AF"
                value={destination}
                onChangeText={setDestination}
                onSubmitEditing={submitSearch}
                returnKeyType="search"
                editable={false}
                accessibilityLabel="Campo de destino"
                importantForAccessibility="no-hide-descendants"
              />
              <View style={styles.searchButton}>
                <MaterialCommunityIcons name="magnify" size={22} color="#9CA3AF" />
              </View>
            </TouchableOpacity>
          </View>
        </ImageBackground>

        <View style={styles.sectionHeader}>
          <PaperText style={styles.sectionTitle}>Favoritos</PaperText>
          <TouchableOpacity
            onPress={openAddFavorite}
            activeOpacity={0.75}
            hitSlop={A11Y_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Adicionar favorito"
          >
            <PaperText style={styles.sectionLink}>Adicionar</PaperText>
          </TouchableOpacity>
        </View>

        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.favoritesScroll}
          contentContainerStyle={styles.favoritesContent}
        >
          {favorites.map((item) => (
            <View key={item.id} style={styles.favoriteCardWrap}>
              <TouchableOpacity
                style={[styles.favoriteCard, sx.fillCard]}
                onPress={() => {
                  if (isConfiguredFavorite(item)) {
                    openFavoriteRoutePlan(item);
                    return;
                  }
                  openFavoriteEditor(item);
                }}
                activeOpacity={0.85}
                accessibilityRole="button"
                accessibilityLabel={`Favorito ${item.label}`}
                accessibilityHint={
                  isConfiguredFavorite(item)
                    ? 'Abre o planejamento de rota para este destino'
                    : 'Editar este endereço favorito'
                }
              >
                <MaterialCommunityIcons
                  name={item.icon as keyof typeof MaterialCommunityIcons.glyphMap}
                  size={26}
                  color="#1E1D1D"
                />
                <PaperText style={styles.favoriteLabel} numberOfLines={2}>
                  {item.label}
                </PaperText>
                <PaperText style={styles.favoriteSubLabel} numberOfLines={2}>
                  {favoriteCardSubtitle(item)}
                </PaperText>
              </TouchableOpacity>
              {/* Por cima do card para o toque no X não abrir o editor */}
              <TouchableOpacity
                style={styles.favoriteDelete}
                onPress={() => confirmRemoveFavorite(item)}
                hitSlop={A11Y_HIT_SLOP}
                accessibilityRole="button"
                accessibilityLabel={`Excluir favorito ${item.label}`}
              >
                <MaterialCommunityIcons name="close" size={16} color="#C5C5C5" />
              </TouchableOpacity>
            </View>
          ))}
        </ScrollView>

        <View style={styles.sectionBlock}>
          <PaperText style={styles.sectionMuted}>Táxi e transporte privado</PaperText>
          <View style={[styles.uberCard, sx.fillCard]}>
            <View style={styles.uberLeft}>
              <View style={styles.uberLogo}>
                <PaperText style={styles.uberLogoText}>U</PaperText>
              </View>
              <View>
                <PaperText style={styles.uberTitle}>Pedir um Uber</PaperText>
                <PaperText style={styles.uberSub}>Toque para pedir uma corrida</PaperText>
              </View>
            </View>
            <TouchableOpacity
              style={styles.uberButton}
              onPress={openUber}
              accessibilityRole="button"
              accessibilityLabel="Pedir Uber"
              accessibilityHint="Abre o aplicativo ou site do Uber"
            >
              <PaperText style={styles.uberButtonText}>Pedir</PaperText>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.recentSection}>
          <PaperText style={styles.sectionTitle}>Viagens recentes</PaperText>
          {!loadingRecents && !hasRecents ? (
            <View style={[styles.emptyWrap, sx.fillScreen]}>
              <MaterialCommunityIcons name="map-search-outline" size={40} color="#CCCCCC" />
              <PaperText style={styles.emptyText}>Nenhuma viagem recente</PaperText>
              <TouchableOpacity
                style={styles.emptyButton}
                onPress={() => router.push('/search-destination')}
                accessibilityRole="button"
                accessibilityLabel="Buscar rota agora"
              >
                <PaperText style={styles.emptyButtonText}>Buscar rota agora</PaperText>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={[styles.recentsGrouped, sx.fillCard]}>
              {recentRoutes.map((route, index) => (
                <View key={route.id}>
                  {index > 0 ? (
                    <View style={styles.recentDividerWrap}>
                      <View style={[styles.recentDividerLine, sx.hairlineTop]} />
                    </View>
                  ) : null}
                  <TouchableOpacity
                    style={styles.recentRow}
                    onPress={() => {
                      const destAddr = route.destinationAddress?.trim() || route.destination;
                      const origAddr = route.originAddress?.trim() || route.origin;
                      goToRoutePlanFromRecent(destAddr, origAddr);
                    }}
                    activeOpacity={0.85}
                    accessibilityRole="button"
                    accessibilityLabel={`Viagem recente de ${route.originAddress?.trim() || route.origin} para ${route.destinationAddress?.trim() || route.destination}`}
                    accessibilityHint="Abre o planejamento de rota com origem e destino preenchidos"
                  >
                    <View style={styles.recentRowIcon}>
                      <MaterialCommunityIcons name="clock-outline" size={20} color="#AAAAAA" />
                    </View>
                    <View style={styles.recentRowText}>
                      <PaperText style={styles.recentRowDestination} numberOfLines={2}>
                        {route.destinationAddress?.trim() || route.destination}
                      </PaperText>
                      {route.destinationTitle?.trim() &&
                      route.destinationTitle.trim() !==
                        (route.destinationAddress?.trim() || route.destination) ? (
                        <PaperText style={styles.recentRowNick} numberOfLines={1}>
                          {route.destinationTitle}
                        </PaperText>
                      ) : null}
                      <PaperText style={styles.recentRowOrigin} numberOfLines={2}>
                        {route.originAddress?.trim() || route.origin}
                      </PaperText>
                      {route.originTitle?.trim() &&
                      route.originTitle.trim() !== (route.originAddress?.trim() || route.origin) ? (
                        <PaperText style={styles.recentRowNick} numberOfLines={1}>
                          {route.originTitle}
                        </PaperText>
                      ) : null}
                    </View>
                    <View style={[styles.badge, styles.badgeInline, route.accessible ? null : styles.badgeWarn]}>
                      <PaperText
                        style={[styles.badgeText, route.accessible ? null : styles.badgeTextWarn]}
                        numberOfLines={1}
                      >
                        {route.accessible ? 'Acessível' : 'Atenção'}
                      </PaperText>
                    </View>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      <View style={[styles.bottomNav, sx.fillCard, sx.hairlineTop]}>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => router.push('/route-results')}
          accessibilityRole="button"
          accessibilityLabel="Direções"
          accessibilityState={{ selected: true }}
        >
          <MaterialCommunityIcons name="map-marker-path" size={23} color="#0057A8" />
          <PaperText style={styles.navActive}>Direções</PaperText>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => router.push('/stations')}
          accessibilityRole="button"
          accessibilityLabel="Estações"
        >
          <MaterialCommunityIcons name="train" size={23} color="#AAAAAA" />
          <PaperText style={styles.navText}>Estações</PaperText>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => router.push('/lines')}
          accessibilityRole="button"
          accessibilityLabel="Linhas"
        >
          <MaterialCommunityIcons name="vector-polyline" size={23} color="#AAAAAA" />
          <PaperText style={styles.navText}>Linhas</PaperText>
        </TouchableOpacity>
        <TouchableOpacity
          style={styles.navItem}
          onPress={() => router.push('/profile')}
          accessibilityRole="button"
          accessibilityLabel="Perfil"
        >
          <MaterialCommunityIcons name="account" size={23} color="#AAAAAA" />
          <PaperText style={styles.navText}>Perfil</PaperText>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  content: {
    paddingBottom: 94,
  },
  header: {
    height: 220,
    overflow: 'hidden',
  },
  headerOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(0,0,0,0.5)',
  },
  headerContent: {
    paddingHorizontal: 24,
    paddingTop: 16,
    paddingBottom: 32,
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 22,
    fontWeight: '700',
    marginTop: 6,
    fontFamily: 'Agrandir-Regular',
  },
  hello: {
    color: '#FFFFFF',
    fontSize: 16,
    marginTop: 60,
    fontFamily: 'Agrandir-Regular',
  },
  searchWrap: {
    marginTop: 20,
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    height: 48,
    flexDirection: 'row',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.08,
    shadowRadius: 8,
    elevation: 3,
  },
  searchInput: {
    flex: 1,
    paddingHorizontal: 16,
    fontSize: 14,
    color: '#1E1D1D',
    fontFamily: 'Agrandir-Regular',
  },
  searchButton: {
    backgroundColor: '#FFFFFF',
    width: 48,
    height: 48,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sectionHeader: {
    marginHorizontal: 16,
    marginTop: 24,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  sectionTitle: {
    color: '#1E1D1D',
    fontSize: 15,
    fontWeight: '700',
    fontFamily: 'Agrandir-TextBold',
  },
  sectionLink: {
    color: '#0057A8',
    fontSize: 13,
    fontFamily: 'Agrandir-Regular',
  },
  favoritesScroll: {
    marginTop: 12,
  },
  favoritesContent: {
    paddingHorizontal: 16,
    paddingRight: 4,
  },
  favoriteCardWrap: {
    width: 170,
    marginRight: 12,
    position: 'relative',
  },
  favoriteDelete: {
    position: 'absolute',
    top: 6,
    right: 6,
    zIndex: 10,
    elevation: 10,
    padding: 2,
    opacity: 0.85,
  },
  favoriteCard: {
    width: '100%',
    height: 135,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 14,
    paddingTop: 28,
    justifyContent: 'flex-start',
    alignItems: 'flex-start',
  },
  favoriteLabel: {
    color: '#1E1D1D',
    fontSize: 16,
    marginTop: 8,
    fontFamily: 'Agrandir-Regular',
    textAlign: 'left',
    alignSelf: 'stretch',
  },
  favoriteSubLabel: {
    color: '#999999',
    fontSize: 10,
    marginTop: 2,
    fontFamily: 'Agrandir-Regular',
    textAlign: 'left',
    alignSelf: 'stretch',
  },
  sectionBlock: {
    marginHorizontal: 16,
    marginTop: 28,
  },
  sectionMuted: {
    color: '#1E1D1D',
    fontSize: 13,
    fontWeight: '500',
    marginBottom: 8,
    fontFamily: 'Agrandir-TextBold',
  },
  uberCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 5,
    elevation: 2,
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
  recentSection: {
    marginHorizontal: 16,
    marginTop: 28,
  },
  emptyWrap: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 26,
  },
  emptyText: {
    color: '#999999',
    fontSize: 13,
    marginTop: 8,
    fontFamily: 'Agrandir-Regular',
  },
  emptyButton: {
    backgroundColor: '#0057A8',
    borderRadius: 40,
    height: 48,
    paddingHorizontal: 18,
    marginTop: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emptyButtonText: {
    color: '#FFFFFF',
    fontFamily: 'Agrandir-TextBold',
  },
  recentsGrouped: {
    marginTop: 12,
    borderRadius: 16,
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 5,
    elevation: 2,
  },
  recentDividerWrap: {
    paddingLeft: 52,
  },
  recentDividerLine: {
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingRight: 12,
    paddingLeft: 4,
  },
  recentRowIcon: {
    width: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recentRowText: {
    flex: 1,
    minWidth: 0,
    paddingRight: 10,
  },
  recentRowOrigin: {
    color: '#999999',
    fontSize: 12,
    marginTop: 2,
    fontFamily: 'Agrandir-Regular',
  },
  recentRowDestination: {
    color: '#1E1D1D',
    fontSize: 14,
    fontWeight: '700',
    fontFamily: 'Agrandir-TextBold',
  },
  recentRowNick: {
    color: '#888888',
    fontSize: 11,
    marginTop: 2,
    fontFamily: 'Agrandir-Regular',
  },
  badge: {
    alignSelf: 'center',
    backgroundColor: '#DCFCE7',
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  badgeInline: {
    flexShrink: 0,
    maxWidth: 96,
  },
  badgeWarn: {
    backgroundColor: '#FEF3C7',
  },
  badgeText: {
    color: '#16A34A',
    fontSize: 11,
    fontFamily: 'Agrandir-Regular',
  },
  badgeTextWarn: {
    color: '#92400E',
  },
  bottomNav: {
    backgroundColor: '#FFFFFF',
    borderTopWidth: 0.5,
    borderTopColor: '#EEEEEE',
    height: 64,
    paddingBottom: 8,
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  navItem: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  navActive: {
    color: '#0057A8',
    fontSize: 11,
    marginTop: 4,
    fontFamily: 'System',
  },
  navText: {
    color: '#AAAAAA',
    fontSize: 11,
    marginTop: 4,
    fontFamily: 'System',
  },
});
