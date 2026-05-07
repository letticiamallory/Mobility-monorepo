import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import type { ComponentProps } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import { ScaledText as Text } from '@/components/ScaledText';
import { ScaledTextInput as TextInput } from '@/components/ScaledTextInput';
import { useAccessibilitySurfaces } from '@/contexts/accessibility-preferences';
import { A11Y_HIT_SLOP } from '@/constants/accessibility';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  generateCustomFavoriteId,
  getHomeFavorites,
  upsertHomeFavorite,
  type HomeFavoriteRow,
} from '../services/home-favorites.service';
import { inferPlaceIcon } from '../utils/place-icon';

const PRIMARY = '#0057A8';
const BG = '#F5F5F5';
const TITLE = '#111827';
const MUTED = '#6B7280';
const BORDER = '#E5E7EB';

function paramOne(v: string | string[] | undefined): string {
  if (v == null) return '';
  return Array.isArray(v) ? (v[0] ?? '') : v;
}

/** Sem nome manual: só a primeira palavra do trecho antes da primeira vírgula (ex.: "Parkshopping, Guará" → "Parkshopping"). */
function shortLabelFromAddress(full: string): string {
  const s = full.trim();
  if (!s) return 'Favorito';
  const head = s.split(',')[0]?.trim() || s;
  const words = head.split(/\s+/).filter(Boolean);
  if (words.length === 0) return 'Favorito';
  return words[0];
}

export default function FavoriteLocationConfirmScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const sx = useAccessibilitySurfaces();
  const mapRef = useRef<MapView>(null);
  const params = useLocalSearchParams<{
    address?: string | string[];
    lat?: string | string[];
    lng?: string | string[];
    favoriteId?: string | string[];
    favoriteAction?: string | string[];
    presetIcon?: string | string[];
    screenTitle?: string | string[];
    inferredIcon?: string | string[];
  }>();

  const address = paramOne(params.address);
  const lat = Number(paramOne(params.lat));
  const lng = Number(paramOne(params.lng));
  const favoriteId = paramOne(params.favoriteId);
  const favoriteAction = paramOne(params.favoriteAction);
  const presetIcon = paramOne(params.presetIcon);
  const screenTitle = paramOne(params.screenTitle);
  const inferredIconParam = paramOne(params.inferredIcon);

  const isAdd = favoriteAction === 'add';
  const coordOk = Number.isFinite(lat) && Number.isFinite(lng);

  const markerIcon = useMemo((): ComponentProps<typeof MaterialCommunityIcons>['name'] => {
    if (isAdd) {
      return (inferredIconParam || inferPlaceIcon(address)) as ComponentProps<
        typeof MaterialCommunityIcons
      >['name'];
    }
    return (presetIcon || inferredIconParam || inferPlaceIcon(address)) as ComponentProps<
      typeof MaterialCommunityIcons
    >['name'];
  }, [address, inferredIconParam, isAdd, presetIcon]);

  const [customName, setCustomName] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (isAdd || !favoriteId) return;
      const list = await getHomeFavorites();
      const ex = list.find((x) => x.id === favoriteId);
      if (!cancelled && ex) setCustomName(ex.label);
    })();
    return () => {
      cancelled = true;
    };
  }, [favoriteId, isAdd]);

  const headerTitle =
    screenTitle ||
    (isAdd ? 'Adicionar aos favoritos' : 'Confirmar local');

  const recenter = useCallback(() => {
    if (!coordOk) return;
    mapRef.current?.animateToRegion(
      {
        latitude: lat,
        longitude: lng,
        latitudeDelta: 0.012,
        longitudeDelta: 0.012,
      },
      320,
    );
  }, [coordOk, lat, lng]);

  const handleSave = async () => {
    if (!coordOk || !address) return;
    setSaving(true);
    try {
      const list = await getHomeFavorites();
      const inferred = (inferredIconParam || inferPlaceIcon(address)) as string;
      const iconUsed = (isAdd ? inferred : presetIcon || inferred) as string;

      if (isAdd) {
        const main = customName.trim() || shortLabelFromAddress(address);
        const row: HomeFavoriteRow = {
          id: generateCustomFavoriteId(),
          label: main,
          subtitle: undefined,
          icon: iconUsed,
          address,
          lat,
          lng,
          isPreset: false,
        };
        await upsertHomeFavorite(row);
      } else if (favoriteId) {
        const existing = list.find((x) => x.id === favoriteId);
        const label = customName.trim() || shortLabelFromAddress(address);
        const row: HomeFavoriteRow = {
          id: favoriteId,
          label,
          subtitle: undefined,
          icon: iconUsed,
          address,
          lat,
          lng,
          isPreset: existing?.isPreset ?? false,
        };
        await upsertHomeFavorite(row);
      }
      router.replace('/home');
    } finally {
      setSaving(false);
    }
  };

  if (!coordOk) {
    return (
      <SafeAreaView style={[styles.root, styles.centered, sx.fillScreen]} edges={['top', 'left', 'right']}>
        <Stack.Screen options={{ headerShown: false }} />
        <Text style={styles.errText}>Localização inválida. Volte e escolha outro endereço.</Text>
        <TouchableOpacity
          style={styles.primaryBtn}
          onPress={() => router.back()}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
        >
          <Text style={styles.primaryBtnText}>Voltar</Text>
        </TouchableOpacity>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={[styles.root, sx.fillScreen]} edges={['left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, sx.fillCard, { paddingTop: insets.top + 8 }]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={A11Y_HIT_SLOP}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={TITLE} />
        </TouchableOpacity>
        <Text style={styles.headerTitle} numberOfLines={2}>
          {headerTitle}
        </Text>
        <View style={styles.backBtn} />
      </View>

      <View style={styles.formBlock}>
        <Text style={styles.fieldLbl}>Nome do local</Text>
        <TextInput
          style={styles.input}
          placeholder="Ex.: Minha casa"
          placeholderTextColor="#9CA3AF"
          value={customName}
          onChangeText={setCustomName}
        />
        <Text style={styles.optional}>Opcional</Text>

        <View style={styles.addrRow}>
          <MaterialCommunityIcons name="map-marker-outline" size={20} color={MUTED} />
          <Text style={styles.addrText} numberOfLines={3}>
            {address}
          </Text>
        </View>

        <TouchableOpacity
          style={[styles.primaryBtn, saving && styles.primaryBtnDisabled]}
          onPress={handleSave}
          disabled={saving}
          accessibilityRole="button"
          accessibilityLabel={saving ? 'Salvando favorito' : 'Salvar favorito'}
          accessibilityState={{ disabled: saving }}
        >
          {saving ? (
            <ActivityIndicator color="#FFFFFF" />
          ) : (
            <Text style={styles.primaryBtnText}>Salvar</Text>
          )}
        </TouchableOpacity>
      </View>

      <View style={styles.mapWrap}>
        <MapView
          ref={mapRef}
          style={StyleSheet.absoluteFill}
          provider={Platform.OS === 'android' ? PROVIDER_GOOGLE : undefined}
          mapType="standard"
          showsUserLocation={false}
          accessibilityLabel={`Mapa do local: ${address}`}
          initialRegion={{
            latitude: lat,
            longitude: lng,
            latitudeDelta: 0.012,
            longitudeDelta: 0.012,
          }}
          onMapReady={recenter}
        >
          <Marker coordinate={{ latitude: lat, longitude: lng }} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.markerCircle}>
              <MaterialCommunityIcons name={markerIcon} size={22} color="#FFFFFF" />
            </View>
          </Marker>
        </MapView>
        <TouchableOpacity
          style={styles.recenter}
          onPress={recenter}
          activeOpacity={0.85}
          accessibilityRole="button"
          accessibilityLabel="Centralizar mapa no marcador"
          hitSlop={A11Y_HIT_SLOP}
        >
          <MaterialCommunityIcons name="crosshairs-gps" size={22} color={PRIMARY} />
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: BG,
  },
  centered: {
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingBottom: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  backBtn: {
    width: 40,
    alignItems: 'flex-start',
  },
  headerTitle: {
    flex: 1,
    textAlign: 'center',
    fontSize: 16,
    fontWeight: '700',
    color: TITLE,
    fontFamily: 'Agrandir-TextBold',
  },
  formBlock: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: BORDER,
  },
  fieldLbl: {
    fontSize: 13,
    fontWeight: '600',
    color: TITLE,
    marginBottom: 6,
    fontFamily: 'Agrandir-TextBold',
  },
  input: {
    borderWidth: 1,
    borderColor: BORDER,
    borderRadius: 10,
    paddingHorizontal: 14,
    height: 48,
    fontSize: 15,
    color: TITLE,
    fontFamily: 'Agrandir-Regular',
    backgroundColor: '#FAFAFA',
  },
  optional: {
    marginTop: 4,
    fontSize: 12,
    color: MUTED,
    fontFamily: 'Agrandir-Regular',
  },
  addrRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 14,
  },
  addrText: {
    flex: 1,
    fontSize: 14,
    color: TITLE,
    fontFamily: 'Agrandir-Regular',
  },
  primaryBtn: {
    backgroundColor: PRIMARY,
    borderRadius: 40,
    height: 52,
    marginTop: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: {
    opacity: 0.6,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '700',
    fontFamily: 'Agrandir-TextBold',
  },
  mapWrap: {
    flex: 1,
    minHeight: 200,
    position: 'relative',
  },
  markerCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1E1D1D',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  recenter: {
    position: 'absolute',
    top: 12,
    right: 12,
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.12,
    shadowRadius: 4,
    shadowOffset: { width: 0, height: 1 },
    elevation: 3,
  },
  errText: {
    fontSize: 15,
    color: MUTED,
    textAlign: 'center',
    fontFamily: 'Agrandir-Regular',
    marginBottom: 16,
  },
});
