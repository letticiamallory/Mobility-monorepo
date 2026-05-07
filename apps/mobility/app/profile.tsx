import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { Alert, Image, ScrollView, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ScaledText as Text } from '@/components/ScaledText';
import { useAccessibilitySurfaces } from '@/contexts/accessibility-preferences';
import { A11Y_HIT_SLOP } from '@/constants/accessibility';
import { SafeAreaView } from 'react-native-safe-area-context';
import { API_URL } from '../constants/api';
import { getToken, getUserInfo, removeToken } from '../services/token.service';

type MeResponse = {
  name?: string;
  email?: string;
  disability_type?: string;
  accompanied?: string;
  avatar_data_url?: string | null;
};

const DISABILITY_LABELS: Record<string, string> = {
  visual: 'Baixa visão',
  wheelchair: 'Cadeirante',
  reduced_mobility: 'Mobilidade reduzida',
};

function formatDisabilityType(type?: string): string {
  if (!type?.trim()) return '—';
  const key = type.trim();
  if (DISABILITY_LABELS[key]) return DISABILITY_LABELS[key];
  const humanized = key.replace(/_/g, ' ');
  return humanized.charAt(0).toUpperCase() + humanized.slice(1);
}

function normalizeMePayload(raw: unknown): MeResponse {
  if (!raw || typeof raw !== 'object') return {};
  const r = raw as Record<string, unknown>;
  return {
    name: typeof r.name === 'string' ? r.name : undefined,
    email: typeof r.email === 'string' ? r.email : undefined,
    disability_type: typeof r.disability_type === 'string' ? r.disability_type : undefined,
    accompanied: typeof r.accompanied === 'string' ? r.accompanied : undefined,
    avatar_data_url:
      typeof r.avatar_data_url === 'string' && r.avatar_data_url.length > 0
        ? r.avatar_data_url
        : null,
  };
}

function initialsFromName(name?: string) {
  const source = (name || 'U').trim();
  return source
    .split(' ')
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => (part[0] || '').toUpperCase())
    .join('');
}

export default function ProfileScreen() {
  const router = useRouter();
  const sx = useAccessibilitySurfaces();
  const [profile, setProfile] = useState<MeResponse>({});
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  const mergeWithLocalInfo = useCallback(async (base: MeResponse): Promise<MeResponse> => {
    const local = await getUserInfo();
    return {
      ...base,
      name: base.name?.trim() || local.name?.trim() || undefined,
      email: base.email?.trim() || local.email?.trim() || undefined,
    };
  }, []);

  const loadProfile = useCallback(async () => {
    const token = await getToken();
    if (!token) {
      router.replace('/login');
      return;
    }

    try {
      const meResponse = await fetch(`${API_URL}/users/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (meResponse.ok) {
        const raw = await meResponse.json();
        const meData = normalizeMePayload(raw);
        setAvatarUri(meData.avatar_data_url ?? null);
        setProfile(await mergeWithLocalInfo(meData));
      } else {
        setAvatarUri(null);
        setProfile(await mergeWithLocalInfo({}));
      }
    } catch {
      setProfile(await mergeWithLocalInfo({}));
    }
  }, [router, mergeWithLocalInfo]);

  useFocusEffect(
    useCallback(() => {
      void loadProfile();
    }, [loadProfile]),
  );

  const initials = useMemo(() => initialsFromName(profile.name), [profile.name]);

  const handleLogout = () => {
    Alert.alert('Sair', 'Deseja realmente encerrar sua sessão?', [
      { text: 'Cancelar', style: 'cancel' },
      {
        text: 'Sair',
        style: 'destructive',
        onPress: () => {
          void (async () => {
            await removeToken();
            router.replace('/login');
          })();
        },
      },
    ]);
  };

  const openProfileInfo = () => {
    router.push({ pathname: '/profile-info', params: { section: 'info' } });
  };

  const openAccessibilitySettings = () => {
    router.push({ pathname: '/profile-info', params: { section: 'accessibility' } });
  };

  const openFavorites = () => {
    router.push('/home');
  };

  const openTripHistory = () => {
    router.push('/profile-history');
  };

  const openChangePassword = () => {
    if (!profile.email) {
      Alert.alert('Atenção', 'Não foi possível identificar seu email para alterar a senha.');
      return;
    }
    router.push({ pathname: '/forgot-password', params: { email: profile.email } });
  };

  return (
    <SafeAreaView style={[styles.safeArea, sx.fillScreen]}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.scrollContent}>
        <View style={[styles.header, sx.fillCard]}>
          <View style={styles.headerTopRow}>
            <TouchableOpacity
              style={styles.backButton}
              onPress={() => router.back()}
              hitSlop={A11Y_HIT_SLOP}
              accessibilityRole="button"
              accessibilityLabel="Voltar"
            >
              <MaterialCommunityIcons name="arrow-left" size={24} color="#1E1D1D" />
            </TouchableOpacity>
            <Text style={styles.headerTitle}>Perfil</Text>
            <View style={styles.headerRightSpacer} />
          </View>

          <View style={styles.profileRow}>
            <View style={styles.initialsCircle}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.initialsText}>{initials}</Text>
              )}
            </View>
            <View style={styles.headerInfoWrap}>
              <Text style={styles.userName} numberOfLines={2}>
                {profile.name || '—'}
              </Text>
              <Text style={styles.userEmail} numberOfLines={2}>
                {profile.email || '—'}
              </Text>
              <Text style={styles.disabilityType} numberOfLines={2}>
                {formatDisabilityType(profile.disability_type)}
              </Text>
            </View>
            <TouchableOpacity
              style={styles.editButton}
              onPress={openProfileInfo}
              accessibilityRole="button"
              accessibilityLabel="Editar minhas informações"
            >
              <Text style={styles.editButtonText}>Editar</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={[styles.listGroup, sx.fillCard]}>
          <TouchableOpacity
            style={styles.listItem}
            onPress={openProfileInfo}
            accessibilityRole="button"
            accessibilityLabel="Minhas informações"
          >
            <View style={styles.listItemLeft}>
              <MaterialCommunityIcons name="account-edit" size={22} color="#0057A8" />
              <Text style={styles.listItemText}>Minhas informações</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#CCCCCC" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.listItem, styles.noBorder]}
            onPress={openAccessibilitySettings}
            accessibilityRole="button"
            accessibilityLabel="Acessibilidade"
            accessibilityHint="Tipo de deficiência, contraste, fonte e leitura por voz"
          >
            <View style={styles.listItemLeft}>
              <MaterialCommunityIcons name="human" size={22} color="#0057A8" />
              <Text style={styles.listItemText}>Acessibilidade</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#CCCCCC" />
          </TouchableOpacity>
        </View>

        <View style={styles.groupDivider} />

        <View style={[styles.listGroup, sx.fillCard]}>
          <TouchableOpacity
            style={styles.listItem}
            onPress={openFavorites}
            accessibilityRole="button"
            accessibilityLabel="Favoritos"
            accessibilityHint="Abre a tela inicial na seção de favoritos"
          >
            <View style={styles.listItemLeft}>
              <MaterialCommunityIcons name="heart-outline" size={22} color="#0057A8" />
              <Text style={styles.listItemText}>Favoritos</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#CCCCCC" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.listItem, styles.noBorder]}
            onPress={openTripHistory}
            accessibilityRole="button"
            accessibilityLabel="Histórico de viagens"
          >
            <View style={styles.listItemLeft}>
              <MaterialCommunityIcons name="history" size={22} color="#0057A8" />
              <Text style={styles.listItemText}>Histórico de viagens</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#CCCCCC" />
          </TouchableOpacity>
        </View>

        <View style={styles.groupDivider} />

        <View style={[styles.listGroup, sx.fillCard]}>
          <TouchableOpacity
            style={styles.listItem}
            onPress={openChangePassword}
            accessibilityRole="button"
            accessibilityLabel="Alterar senha"
          >
            <View style={styles.listItemLeft}>
              <MaterialCommunityIcons name="lock-outline" size={22} color="#0057A8" />
              <Text style={styles.listItemText}>Alterar senha</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#CCCCCC" />
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.listItem, styles.noBorder]}
            onPress={handleLogout}
            accessibilityRole="button"
            accessibilityLabel="Sair da conta"
          >
            <View style={styles.listItemLeft}>
              <MaterialCommunityIcons name="logout" size={22} color="#EF4444" />
              <Text style={styles.logoutItemText}>Sair</Text>
            </View>
            <MaterialCommunityIcons name="chevron-right" size={20} color="#EF4444" />
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#F5F5F5',
  },
  scrollContent: {
    paddingBottom: 40,
  },
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 14,
  },
  headerTopRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  backButton: {
    width: 24,
    alignItems: 'flex-start',
  },
  headerTitle: {
    color: '#1E1D1D',
    fontSize: 18,
    fontWeight: '700',
    textAlign: 'center',
  },
  headerRightSpacer: {
    width: 24,
  },
  initialsCircle: {
    width: 64,
    height: 64,
    backgroundColor: '#EBF3FF',
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
  },
  profileRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 14,
  },
  initialsText: {
    color: '#0057A8',
    fontSize: 22,
    fontWeight: '700',
  },
  headerInfoWrap: {
    flex: 1,
    minWidth: 0,
    marginLeft: 16,
    marginRight: 8,
  },
  userName: {
    color: '#1E1D1D',
    fontSize: 17,
    fontWeight: '700',
  },
  userEmail: {
    color: '#666666',
    fontSize: 13,
    marginTop: 2,
  },
  disabilityType: {
    color: '#0057A8',
    fontSize: 12,
    marginTop: 2,
  },
  editButton: {
    borderWidth: 1,
    borderColor: '#0057A8',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  editButtonText: {
    color: '#0057A8',
    fontSize: 13,
  },
  listGroup: {
    marginTop: 8,
    backgroundColor: '#FFFFFF',
  },
  listItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  listItemLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  listItemText: {
    color: '#1E1D1D',
    fontSize: 15,
  },
  logoutItemText: {
    color: '#EF4444',
    fontSize: 15,
  },
  groupDivider: {
    height: 8,
    backgroundColor: '#F5F5F5',
  },
  noBorder: {
    borderBottomWidth: 0,
  },
});
