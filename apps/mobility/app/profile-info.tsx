import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Platform,
  ScrollView,
  StyleSheet,
  Switch,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { ScaledText as Text } from '@/components/ScaledText';
import { ScaledTextInput as TextInput } from '@/components/ScaledTextInput';
import { useAccessibilityPreferences, useAccessibilitySurfaces } from '@/contexts/accessibility-preferences';
import { A11Y_HIT_SLOP } from '@/constants/accessibility';
import { API_URL } from '../constants/api';
import type { FontSizeTier } from '../services/accessibility-prefs.service';
import { getToken, saveUserInfo } from '../services/token.service';

type MeResponse = {
  id?: number;
  name?: string;
  email?: string;
  disability_type?: string;
  accompanied?: string;
  phone?: string;
  birth_date?: string;
  /** Data URL da foto salva no servidor (PostgreSQL). */
  avatar_data_url?: string | null;
};

async function readApiErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as {
      message?: string | string[];
      error?: string;
    };
    if (Array.isArray(body.message)) return body.message.filter(Boolean).join('\n');
    if (typeof body.message === 'string' && body.message.trim()) return body.message;
    if (typeof body.error === 'string' && body.error.trim()) return body.error;
  } catch {
    /* ignore */
  }
  if (response.status === 401) return 'Sessão expirada. Faça login novamente.';
  return fallback;
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

function toYmd(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

function parseYmd(s?: string): Date | null {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

function formatBr(s?: string) {
  const d = parseYmd(s);
  if (!d) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
}

export default function ProfileInfoScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const a11y = useAccessibilityPreferences();
  const sx = useAccessibilitySurfaces();
  const params = useLocalSearchParams<{ section?: string | string[] }>();
  const sectionParam = useMemo<'info' | 'accessibility'>(() => {
    const raw = Array.isArray(params.section) ? params.section[0] : params.section;
    return raw === 'accessibility' ? 'accessibility' : 'info';
  }, [params.section]);
  const [loading, setLoading] = useState(false);
  const [savingData, setSavingData] = useState(false);
  const [savingPrefs, setSavingPrefs] = useState(false);
  const [form, setForm] = useState<MeResponse>({});
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [pickerDate, setPickerDate] = useState<Date>(() => parseYmd(undefined) ?? new Date(1990, 0, 1));
  const [voiceRead, setVoiceRead] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [fontSize, setFontSize] = useState<FontSizeTier>('A');

  useFocusEffect(
    useCallback(() => {
      if (!a11y.hydrated || sectionParam !== 'accessibility') return;
      setVoiceRead(a11y.voiceRead);
      setHighContrast(a11y.highContrast);
      setFontSize(a11y.fontSize);
    }, [
      a11y.hydrated,
      a11y.voiceRead,
      a11y.highContrast,
      a11y.fontSize,
      sectionParam,
    ]),
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const token = await getToken();
        if (!token) {
          router.replace('/login');
          return;
        }
        const meRes = await fetch(`${API_URL}/users/me`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!meRes.ok) return;
        const data = (await meRes.json()) as MeResponse;
        if (cancelled) return;
        setForm(data);
        if (!cancelled) setAvatarUri(data.avatar_data_url ?? null);
        const bd = parseYmd(data.birth_date);
        if (bd) setPickerDate(bd);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const initials = useMemo(() => initialsFromName(form.name), [form.name]);

  const canSaveData = useMemo(() => (form.name ?? '').trim().length >= 2, [form.name]);

  const pickAvatar = useCallback(async () => {
    const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!perm.granted) {
      Alert.alert('Permissão', 'Precisamos de acesso à galeria para alterar a foto.');
      return;
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      aspect: [1, 1],
      quality: 0.55,
      base64: true,
    });
    if (result.canceled || !result.assets?.[0]?.uri) return;
    const asset = result.assets[0];
    if (!asset.base64) {
      Alert.alert('Erro', 'Não foi possível ler a imagem. Tente outra foto.');
      return;
    }
    const mime = asset.mimeType ?? 'image/jpeg';
    setAvatarUri(`data:${mime};base64,${asset.base64}`);

    try {
      const token = await getToken();
      if (!token) {
        router.replace('/login');
        return;
      }
      const response = await fetch(`${API_URL}/users/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          avatar_base64: asset.base64,
          avatar_mime: mime,
        }),
      });
      if (!response.ok) {
        const msg = await readApiErrorMessage(response, 'Não foi possível salvar a foto.');
        Alert.alert('Erro', msg);
        return;
      }
      const data = (await response.json()) as MeResponse;
      if (data.avatar_data_url) setAvatarUri(data.avatar_data_url);
    } catch {
      Alert.alert('Erro', 'Não foi possível salvar sua foto. Tente novamente.');
    }
  }, [router]);

  const onDateChange = (event: DateTimePickerEvent, date?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (event.type === 'dismissed') return;
    if (date) {
      setPickerDate(date);
      setForm((prev) => ({ ...prev, birth_date: toYmd(date) }));
    }
  };

  const handleSaveData = async () => {
    if (!canSaveData) {
      Alert.alert('Atenção', 'Informe um nome com pelo menos 2 caracteres.');
      return;
    }
    try {
      setSavingData(true);
      const token = await getToken();
      if (!token) {
        router.replace('/login');
        return;
      }
      const response = await fetch(`${API_URL}/users/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          name: form.name?.trim(),
          phone: (form.phone ?? '').trim() || undefined,
          birth_date: form.birth_date?.trim() || undefined,
        }),
      });
      if (!response.ok) {
        const msg = await readApiErrorMessage(response, 'Não foi possível salvar suas informações.');
        Alert.alert('Erro', msg);
        return;
      }
      const data = (await response.json()) as MeResponse;
      setForm((prev) => ({ ...prev, ...data }));
      if (data.id != null && data.name?.trim()) {
        await saveUserInfo(data.id, data.name.trim(), data.email?.trim());
      }
      Alert.alert('Sucesso', 'Dados atualizados.');
    } catch {
      Alert.alert('Erro', 'Não foi possível salvar suas informações.');
    } finally {
      setSavingData(false);
    }
  };

  const handleSavePreferences = async () => {
    try {
      setSavingPrefs(true);
      await a11y.commitAccessibilityUiPrefs({
        voiceRead,
        highContrast,
        fontSize,
      });
      const token = await getToken();
      if (!token) {
        router.replace('/login');
        return;
      }
      const response = await fetch(`${API_URL}/users/me`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          disability_type: form.disability_type,
        }),
      });
      if (!response.ok) {
        const msg = await readApiErrorMessage(response, 'Não foi possível salvar as preferências.');
        Alert.alert('Erro', msg);
        return;
      }
      const data = (await response.json()) as MeResponse;
      setForm((prev) => ({ ...prev, ...data }));
      Alert.alert('Sucesso', 'Preferências salvas.');
      a11y.speakIfEnabled('Preferências salvas.', { voiceReadOverride: voiceRead });
    } catch {
      Alert.alert('Erro', 'Não foi possível salvar as preferências.');
    } finally {
      setSavingPrefs(false);
    }
  };

  const disabilityCards = [
    {
      key: 'visual' as const,
      icon: 'eye-outline' as const,
      title: 'Visual',
      desc: 'Deficiência visual ou baixa visão',
    },
    {
      key: 'wheelchair' as const,
      icon: 'wheelchair-accessibility' as const,
      title: 'Cadeirante',
      desc: 'Usuário de cadeira de rodas',
    },
    {
      key: 'reduced_mobility' as const,
      icon: 'walk' as const,
      title: 'Mobilidade reduzida',
      desc: 'Dificuldade de locomoção ou equilíbrio',
    },
  ];

  return (
    <SafeAreaView style={[styles.root, sx.fillScreen]} edges={['left', 'right', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.headerWrap, sx.fillCard, sx.hairlineBottom, { paddingTop: insets.top + 8 }]}>
        <View style={styles.headerRow}>
          <TouchableOpacity
            onPress={() => router.back()}
            hitSlop={A11Y_HIT_SLOP}
            style={styles.headerSide}
            accessibilityRole="button"
            accessibilityLabel="Voltar"
          >
            <MaterialCommunityIcons name="arrow-left" size={22} color="#1E1D1D" />
          </TouchableOpacity>
          <View style={styles.headerCenter}>
            <Text style={styles.headerTitle}>
              {sectionParam === 'accessibility' ? 'Acessibilidade' : 'Minhas informações'}
            </Text>
          </View>
          <View style={styles.headerSide} />
        </View>
      </View>

      {sectionParam === 'info' ? (
        <ScrollView
          contentContainerStyle={styles.scrollData}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={styles.avatarBlock}>
            <View style={styles.avatarCircle}>
              {avatarUri ? (
                <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
              ) : (
                <Text style={styles.avatarInitials}>{initials}</Text>
              )}
              <TouchableOpacity
                style={styles.cameraBtn}
                onPress={pickAvatar}
                activeOpacity={0.9}
                accessibilityRole="button"
                accessibilityLabel="Alterar foto do perfil"
                accessibilityHint="Abre a galeria para escolher uma nova foto"
              >
                <MaterialCommunityIcons name="camera" size={14} color="#FFFFFF" />
              </TouchableOpacity>
            </View>
            <Text style={styles.changePhotoText}>Alterar foto</Text>
          </View>

          <View style={[styles.card, sx.fillCard]}>
            <Text style={styles.fieldLabel}>Nome completo</Text>
            <View style={styles.fieldRow}>
              <TextInput
                style={styles.fieldInput}
                value={form.name ?? ''}
                onChangeText={(name) => setForm((p) => ({ ...p, name }))}
                placeholder="Seu nome"
                placeholderTextColor="#9CA3AF"
                accessibilityLabel="Nome completo"
              />
              <MaterialCommunityIcons name="account-outline" size={18} color="#0057A8" />
            </View>
            <View style={styles.divider} />

            <Text style={styles.fieldLabel}>Email</Text>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => Alert.alert('Email', 'O email não pode ser alterado')}
              accessibilityRole="button"
              accessibilityLabel="Email"
              accessibilityHint="Toque para ver que o email não pode ser alterado"
            >
              <View style={styles.fieldRow}>
                <TextInput
                  style={[styles.fieldInput, styles.fieldInputReadonly]}
                  value={form.email ?? ''}
                  editable={false}
                  placeholder="—"
                  placeholderTextColor="#AAAAAA"
                  accessibilityLabel="Email somente leitura"
                />
                <MaterialCommunityIcons name="email-outline" size={18} color="#CCCCCC" />
              </View>
            </TouchableOpacity>
            <View style={styles.divider} />

            <Text style={styles.fieldLabel}>Telefone</Text>
            <View style={styles.fieldRow}>
              <TextInput
                style={styles.fieldInput}
                value={form.phone ?? ''}
                onChangeText={(phone) => setForm((p) => ({ ...p, phone }))}
                placeholder="(00) 00000-0000"
                placeholderTextColor="#9CA3AF"
                keyboardType="phone-pad"
                accessibilityLabel="Telefone"
                textContentType="telephoneNumber"
              />
              <MaterialCommunityIcons name="phone-outline" size={18} color="#0057A8" />
            </View>
            <View style={styles.divider} />

            <Text style={styles.fieldLabel}>Data de nascimento</Text>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => {
                setPickerDate(parseYmd(form.birth_date) ?? new Date(1990, 0, 1));
                setShowDatePicker(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="Data de nascimento"
              accessibilityHint="Abre o seletor de data"
            >
              <View style={styles.fieldRow}>
                <Text style={styles.birthText}>
                  {form.birth_date ? formatBr(form.birth_date) : 'Toque para selecionar'}
                </Text>
                <MaterialCommunityIcons name="calendar-outline" size={18} color="#0057A8" />
              </View>
            </TouchableOpacity>
          </View>

          {showDatePicker ? (
            <DateTimePicker
              value={pickerDate}
              mode="date"
              display={Platform.OS === 'ios' ? 'spinner' : 'default'}
              onChange={onDateChange}
              maximumDate={new Date()}
            />
          ) : null}
          {Platform.OS === 'ios' && showDatePicker ? (
            <TouchableOpacity
              style={styles.iosDateClose}
              onPress={() => setShowDatePicker(false)}
              accessibilityRole="button"
              accessibilityLabel="Fechar calendário"
            >
              <Text style={styles.iosDateCloseText}>Fechar</Text>
            </TouchableOpacity>
          ) : null}

          <TouchableOpacity
            style={[styles.primaryBtn, (!canSaveData || savingData || loading) && styles.primaryBtnDisabled]}
            disabled={!canSaveData || savingData || loading}
            onPress={handleSaveData}
            accessibilityRole="button"
            accessibilityLabel={savingData ? 'Salvando dados' : 'Salvar alterações das informações'}
            accessibilityState={{ disabled: !canSaveData || savingData || loading }}
          >
            <Text style={styles.primaryBtnText}>{savingData ? 'Salvando...' : 'Salvar alterações'}</Text>
          </TouchableOpacity>
        </ScrollView>
      ) : (
        <ScrollView
          style={styles.a11yScroll}
          contentContainerStyle={styles.a11yScrollContent}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <View style={[styles.cardBlock, sx.fillCard]}>
            <Text style={styles.cardTitle}>Tipo de deficiência</Text>
            <Text style={styles.cardSubtitle}>Selecione o que melhor descreve você</Text>
            {disabilityCards.map((item) => {
              const selected = form.disability_type === item.key;
              return (
                <TouchableOpacity
                  key={item.key}
                  style={[styles.disabilityCard, selected && styles.disabilityCardSelected]}
                  onPress={() => setForm((p) => ({ ...p, disability_type: item.key }))}
                  activeOpacity={0.88}
                  accessibilityRole="button"
                  accessibilityLabel={`${item.title}. ${item.desc}`}
                  accessibilityState={{ selected }}
                >
                  <View style={styles.disabilityIconWrap}>
                    <MaterialCommunityIcons name={item.icon} size={22} color="#0057A8" />
                  </View>
                  <View style={styles.disabilityTextCol}>
                    <Text style={styles.disabilityTitle}>{item.title}</Text>
                    <Text style={styles.disabilityDesc}>{item.desc}</Text>
                  </View>
                  {selected ? (
                    <MaterialCommunityIcons name="check-circle" size={20} color="#0057A8" />
                  ) : (
                    <View style={{ width: 20 }} />
                  )}
                </TouchableOpacity>
              );
            })}
          </View>

          <View style={[styles.cardBlock, sx.fillCard]}>
            <Text style={styles.cardTitle}>Configurações de acessibilidade</Text>
            <View style={styles.settingsItem}>
              <View style={styles.settingsLeft}>
                <MaterialCommunityIcons name="volume-high" size={22} color="#0057A8" />
                <View style={styles.settingsTextCol}>
                  <Text style={styles.settingsTitle}>Leitura por voz</Text>
                  <Text style={styles.settingsSub}>Lê as instruções em voz alta</Text>
                </View>
              </View>
              <Switch
                value={voiceRead}
                onValueChange={setVoiceRead}
                trackColor={{ false: '#E5E7EB', true: '#0057A8' }}
                thumbColor="#FFFFFF"
                accessibilityLabel="Leitura por voz"
                accessibilityHint="Lê instruções de rota em voz alta quando disponível"
              />
            </View>
            <View style={styles.settingsItem}>
              <View style={styles.settingsLeft}>
                <MaterialCommunityIcons name="contrast-circle" size={22} color="#0057A8" />
                <View style={styles.settingsTextCol}>
                  <Text style={styles.settingsTitle}>Alto contraste</Text>
                  <Text style={styles.settingsSub}>Aumenta o contraste das cores</Text>
                </View>
              </View>
              <Switch
                value={highContrast}
                onValueChange={setHighContrast}
                trackColor={{ false: '#E5E7EB', true: '#0057A8' }}
                thumbColor="#FFFFFF"
                accessibilityLabel="Alto contraste"
                accessibilityHint="Aumenta o contraste das cores em todo o aplicativo"
              />
            </View>
            <View style={[styles.settingsItem, { borderBottomWidth: 0 }]}>
              <View style={styles.settingsLeft}>
                <MaterialCommunityIcons name="format-size" size={22} color="#0057A8" />
                <View style={styles.settingsTextCol}>
                  <Text style={styles.settingsTitle}>Tamanho da fonte</Text>
                  <Text style={styles.settingsSub}>Ajuste o tamanho do texto</Text>
                </View>
              </View>
              <View style={styles.fontRow}>
                {(['A', 'AA', 'AAA'] as FontSizeTier[]).map((k) => (
                  <TouchableOpacity
                    key={k}
                    style={[styles.fontChip, fontSize === k && styles.fontChipActive]}
                    onPress={() => setFontSize(k)}
                    accessibilityRole="button"
                    accessibilityLabel={`Tamanho de texto ${k === 'A' ? 'normal' : k === 'AA' ? 'médio' : 'grande'}`}
                    accessibilityState={{ selected: fontSize === k }}
                  >
                    <Text style={[styles.fontChipText, fontSize === k && styles.fontChipTextActive]}>{k}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          </View>

          <TouchableOpacity
            style={[
              styles.primaryBtn,
              styles.a11ySaveBtn,
              (savingPrefs || loading) && styles.primaryBtnDisabled,
            ]}
            disabled={savingPrefs || loading}
            onPress={handleSavePreferences}
            accessibilityRole="button"
            accessibilityLabel={savingPrefs ? 'Salvando preferências' : 'Salvar preferências de acessibilidade'}
            accessibilityState={{ disabled: savingPrefs || loading }}
          >
            <Text style={styles.primaryBtnText}>{savingPrefs ? 'Salvando...' : 'Salvar preferências'}</Text>
          </TouchableOpacity>
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#F5F7FA',
  },
  headerWrap: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#EEEEEE',
  },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerSide: {
    width: 40,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  headerCenter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerTitle: {
    color: '#1E1D1D',
    fontSize: 16,
    fontWeight: '600',
  },
  scrollData: {
    paddingHorizontal: 16,
    paddingTop: 20,
    paddingBottom: 40,
  },
  a11yScroll: {
    flex: 1,
  },
  a11yScrollContent: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 32,
  },
  a11ySaveBtn: {
    marginTop: 10,
    marginBottom: 8,
  },
  avatarBlock: {
    alignItems: 'center',
    marginBottom: 8,
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#EBF3FF',
    alignItems: 'center',
    justifyContent: 'center',
    position: 'relative',
    alignSelf: 'center',
  },
  avatarImage: {
    width: 80,
    height: 80,
    borderRadius: 40,
  },
  avatarInitials: {
    color: '#0057A8',
    fontSize: 28,
    fontWeight: '700',
  },
  cameraBtn: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#0057A8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  changePhotoText: {
    color: '#0057A8',
    fontSize: 12,
    textAlign: 'center',
    marginTop: 8,
    marginBottom: 24,
  },
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  fieldLabel: {
    color: '#999999',
    fontSize: 12,
    fontWeight: '500',
    marginBottom: 6,
  },
  fieldRow: {
    backgroundColor: '#F5F7FA',
    borderRadius: 10,
    height: 48,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  fieldInput: {
    flex: 1,
    fontSize: 14,
    color: '#1E1D1D',
    paddingVertical: 0,
  },
  fieldInputReadonly: {
    color: '#AAAAAA',
  },
  birthText: {
    flex: 1,
    fontSize: 14,
    color: '#1E1D1D',
    ...Platform.select({
      android: { textAlignVertical: 'center' },
      ios: { lineHeight: 20 },
    }),
  },
  divider: {
    height: 1,
    backgroundColor: '#F0F0F0',
    marginVertical: 12,
  },
  primaryBtn: {
    backgroundColor: '#0057A8',
    borderRadius: 40,
    height: 52,
    marginTop: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  primaryBtnDisabled: {
    opacity: 0.5,
  },
  primaryBtnText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
  cardBlock: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 20,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  cardTitle: {
    color: '#1E1D1D',
    fontSize: 15,
    fontWeight: '700',
  },
  cardSubtitle: {
    color: '#999999',
    fontSize: 12,
    marginTop: 4,
    marginBottom: 16,
  },
  disabilityCard: {
    backgroundColor: '#F5F7FA',
    borderRadius: 12,
    padding: 14,
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 12,
  },
  disabilityCardSelected: {
    backgroundColor: '#EBF3FF',
    borderWidth: 1.5,
    borderColor: '#0057A8',
  },
  disabilityIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  disabilityTextCol: {
    flex: 1,
  },
  disabilityTitle: {
    color: '#1E1D1D',
    fontSize: 14,
    fontWeight: '600',
  },
  disabilityDesc: {
    color: '#999999',
    fontSize: 12,
    marginTop: 2,
  },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#F0F0F0',
  },
  settingsLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  settingsTextCol: {
    flex: 1,
  },
  settingsTitle: {
    color: '#1E1D1D',
    fontSize: 14,
    fontWeight: '500',
  },
  settingsSub: {
    color: '#999999',
    fontSize: 12,
    marginTop: 2,
  },
  fontRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  fontChip: {
    backgroundColor: '#F0F0F0',
    borderRadius: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
  },
  fontChipActive: {
    backgroundColor: '#0057A8',
  },
  fontChipText: {
    color: '#666666',
    fontSize: 13,
    fontWeight: '600',
  },
  fontChipTextActive: {
    color: '#FFFFFF',
  },
  iosDateClose: {
    alignItems: 'center',
    paddingVertical: 8,
  },
  iosDateCloseText: {
    color: '#0057A8',
    fontWeight: '600',
  },
});
