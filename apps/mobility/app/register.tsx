import { useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import * as ImagePicker from 'expo-image-picker';
import {
  Alert,
  Dimensions,
  Image,
  Keyboard,
  KeyboardAvoidingView,
  type KeyboardEvent,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { ScaledText as Text } from '@/components/ScaledText';
import { ScaledTextInput as TextInput } from '@/components/ScaledTextInput';
import { useAccessibilitySurfaces } from '@/contexts/accessibility-preferences';
import { A11Y_HIT_SLOP } from '@/constants/accessibility';
import { register } from '../services/auth.service';
import WomanAvatarIllustration from '../assets/images/undraw_a-woman-avatar_ifsl.svg';

const SCREEN_H = Dimensions.get('window').height;
const MENU_MARGIN = 12;
const ROW_H = 52;
const PRIMARY = '#0057A8';

type DisabilityType = 'visual' | 'wheelchair' | 'reduced_mobility' | '';
type MenuKind = 'group';

const DISABILITY_OPTIONS = [
  { label: 'Deficiencia Visual', value: 'visual' as const, icon: 'eye-off' as const },
  { label: 'Cadeirante', value: 'wheelchair' as const, icon: 'wheelchair-accessibility' as const },
  { label: 'Mobilidade Reduzida', value: 'reduced_mobility' as const, icon: 'walk' as const },
];

type MenuAnchor = {
  x: number;
  y: number;
  width: number;
  height: number;
  top: number;
  listHeight: number;
  scroll: boolean;
};

function computeMenuPlacement(
  y: number,
  h: number,
  itemCount: number,
  preferUp: boolean,
): { top: number; listHeight: number; scroll: boolean } {
  const fullH = itemCount * ROW_H;
  const spaceBelow = SCREEN_H - y - h - MENU_MARGIN;
  const spaceAbove = y - MENU_MARGIN;

  /** Menu no fim do formul?rio: prioriza abrir para cima (mais espa?o ?til). */
  if (preferUp) {
    if (spaceAbove >= fullH) {
      return { top: y - fullH, listHeight: fullH, scroll: false };
    }
    if (spaceAbove >= ROW_H) {
      const listHeight = Math.max(ROW_H, Math.min(fullH, Math.floor(spaceAbove - 4)));
      return { top: y - listHeight, listHeight, scroll: listHeight < fullH };
    }
    if (spaceBelow >= fullH) {
      return { top: y + h, listHeight: fullH, scroll: false };
    }
    const listHeight = Math.max(ROW_H, Math.min(fullH, Math.floor(spaceBelow)));
    return { top: y + h, listHeight, scroll: listHeight < fullH };
  }

  const fitsBelow = spaceBelow >= fullH;
  if (fitsBelow) {
    return { top: y + h, listHeight: fullH, scroll: false };
  }

  const fitsAbove = spaceAbove >= fullH;
  if (fitsAbove) {
    return { top: y - fullH, listHeight: fullH, scroll: false };
  }

  if (spaceAbove >= spaceBelow) {
    const listHeight = Math.max(ROW_H, Math.min(fullH, Math.floor(spaceAbove - 4)));
    return { top: y - listHeight, listHeight, scroll: listHeight < fullH };
  }

  const listHeight = Math.max(ROW_H, Math.min(fullH, Math.floor(spaceBelow)));
  return { top: y + h, listHeight, scroll: listHeight < fullH };
}

export default function RegisterScreen() {
  const router = useRouter();
  const sx = useAccessibilitySurfaces();
  const formScrollRef = useRef<ScrollView>(null);
  const groupRef = useRef<View>(null);
  const confirmPasswordFocusedRef = useRef(false);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [disabilityType, setDisabilityType] = useState<DisabilityType>('');
  const [loading, setLoading] = useState(false);
  const [avatarUri, setAvatarUri] = useState<string | null>(null);
  /** Enviado no POST /users junto com o cadastro (persistido no PostgreSQL). */
  const [avatarForApi, setAvatarForApi] = useState<{ b64: string; mime: string } | null>(null);
  const [showAvatarAccessModal, setShowAvatarAccessModal] = useState(false);

  const [menu, setMenu] = useState<MenuKind | null>(null);
  const [anchor, setAnchor] = useState<MenuAnchor | null>(null);
  /** Espaço extra no fundo do ScrollView = altura do teclado, para poder rolar o campo “Confirmar senha” acima dele. */
  const [keyboardBottomInset, setKeyboardBottomInset] = useState(0);

  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';
    const onShow = (e: KeyboardEvent) => setKeyboardBottomInset(e.endCoordinates.height);
    const onHide = () => setKeyboardBottomInset(0);
    const subShow = Keyboard.addListener(showEvent, onShow);
    const subHide = Keyboard.addListener(hideEvent, onHide);
    return () => {
      subShow.remove();
      subHide.remove();
    };
  }, []);

  /** No Android o teclado abre depois do onFocus — volta a rolar quando a altura do teclado for conhecida. */
  useEffect(() => {
    if (keyboardBottomInset <= 0 || !confirmPasswordFocusedRef.current) return;
    const t = setTimeout(() => {
      formScrollRef.current?.scrollToEnd({ animated: true });
    }, 80);
    return () => clearTimeout(t);
  }, [keyboardBottomInset]);

  const closeMenu = useCallback(() => {
    setMenu(null);
    setAnchor(null);
  }, []);

  const openMenu = useCallback(
    (kind: MenuKind, ref: React.RefObject<View | null>) => {
      if (menu === kind) {
        closeMenu();
        return;
      }
      ref.current?.measureInWindow((x, y, width, height) => {
        const count = DISABILITY_OPTIONS.length;
        const preferUp = false;
        const { top, listHeight, scroll } = computeMenuPlacement(y, height, count, preferUp);
        setAnchor({
          x,
          y,
          width,
          height,
          top,
          listHeight,
          scroll,
        });
        setMenu(kind);
      });
    },
    [menu, closeMenu],
  );

  const disabilityLabel =
    DISABILITY_OPTIONS.find((o) => o.value === disabilityType)?.label ?? null;
  const passwordsMatch = confirmPassword.length > 0 && confirmPassword === password;

  const passwordRules = {
    minLen: password.length >= 8,
    hasSpecial: /[^A-Za-z0-9]/.test(password),
    hasNumber: /\d/.test(password),
  };

  const scrollPasswordFieldIntoView = useCallback(() => {
    requestAnimationFrame(() => {
      setTimeout(() => {
        formScrollRef.current?.scrollTo({ y: 220, animated: true });
      }, 50);
    });
  }, []);

  /** Confirmação de senha fica no meio do formulário — rola até o fim para ficar acima do teclado. */
  const scrollConfirmPasswordIntoView = useCallback(() => {
    const delay = Platform.OS === 'ios' ? 100 : 220;
    requestAnimationFrame(() => {
      setTimeout(() => {
        formScrollRef.current?.scrollToEnd({ animated: true });
      }, delay);
    });
  }, []);

  const handleSubmit = async () => {
    if (!name || !email || !password || !disabilityType || !passwordsMatch) {
      Alert.alert('Atencao', 'Preencha nome, email, senha, confirme a senha e grupo.');
      return;
    }

    try {
      setLoading(true);
      await register(
        name,
        email,
        password,
        disabilityType,
        undefined,
        confirmPassword,
        avatarForApi?.b64,
        avatarForApi?.mime,
      );
      router.replace({
        pathname: '/email-confirmation',
        params: { email: email.trim().toLowerCase() },
      });
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Não foi possível concluir o cadastro. Tente novamente.';
      Alert.alert('Erro', message);
    } finally {
      setLoading(false);
    }
  };

  const pickAvatarImage = async () => {
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
    setAvatarForApi({ b64: asset.base64, mime });
    setAvatarUri(`data:${mime};base64,${asset.base64}`);
  };

  const handlePickAvatar = async (mode: 'full' | 'limited') => {
    try {
      setShowAvatarAccessModal(false);

      if (mode === 'limited' && Platform.OS === 'ios') {
        const current = await ImagePicker.getMediaLibraryPermissionsAsync();
        if (!current.granted) {
          const req = await ImagePicker.requestMediaLibraryPermissionsAsync();
          if (!req.granted) {
            Alert.alert('Permissão necessária', 'Permita acesso às fotos para alterar o avatar.');
            return;
          }
        }
        await pickAvatarImage();
        return;
      }

      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert('Permissão necessária', 'Permita acesso às fotos para alterar o avatar.');
        return;
      }
      await pickAvatarImage();
    } catch {
      Alert.alert('Erro', 'Não foi possível selecionar a imagem.');
    }
  };

  const renderMenuRows = (
    options: typeof DISABILITY_OPTIONS,
    selected: string,
    onPick: (value: DisabilityType) => void,
  ) => {
    const body = options.map((option, index) => {
      const isSelected = selected === option.value;
      const isLast = index === options.length - 1;
      return (
        <TouchableOpacity
          key={option.value}
          style={[
            styles.menuRow,
            !isLast && styles.menuRowBorder,
            isSelected && styles.menuRowSelected,
          ]}
          onPress={() => {
            onPick(option.value);
            closeMenu();
          }}
          activeOpacity={0.75}
          accessibilityRole="menuitem"
          accessibilityState={{ selected: isSelected }}
          accessibilityLabel={option.label}
        >
          <MaterialCommunityIcons name={option.icon} size={20} color="#0057A8" />
          <Text style={[styles.menuRowText, isSelected && styles.menuRowTextSelected]}>
            {option.label}
          </Text>
        </TouchableOpacity>
      );
    });

    if (!anchor) return null;

    if (anchor.scroll) {
      return (
        <ScrollView
          style={{ maxHeight: anchor.listHeight }}
          keyboardShouldPersistTaps="handled"
          bounces={false}
        >
          {body}
        </ScrollView>
      );
    }

    return <View>{body}</View>;
  };

  return (
    <SafeAreaView style={[styles.container, sx.fillScreen]} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
      <ScrollView
        ref={formScrollRef}
        style={styles.formScroll}
        contentContainerStyle={[styles.form, { paddingBottom: 48 + keyboardBottomInset }]}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.push('/login')}
          hitSlop={A11Y_HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Voltar para o login"
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={PRIMARY} />
        </TouchableOpacity>

        <View style={styles.avatarWrap}>
          <TouchableOpacity
            style={styles.avatarCircle}
            onPress={() => setShowAvatarAccessModal(true)}
            activeOpacity={0.85}
            accessibilityRole="button"
            accessibilityLabel="Alterar foto do perfil"
            accessibilityHint="Abre opções para escolher imagem da galeria"
          >
            {avatarUri ? (
              <Image source={{ uri: avatarUri }} style={styles.avatarImage} />
            ) : (
              <WomanAvatarIllustration width={80} height={80} />
            )}
            <View style={styles.editBadge}>
              <MaterialCommunityIcons name="pencil" size={14} color="#FFFFFF" />
            </View>
          </TouchableOpacity>
        </View>

        <Text style={styles.label}>Nome</Text>
        <TextInput
          testID="input-nome"
          style={styles.input}
          placeholder="Seu nome"
          placeholderTextColor="#AAAAAA"
          value={name}
          onChangeText={setName}
          autoCapitalize="words"
          accessibilityLabel="Nome"
          textContentType="name"
        />

        <Text style={styles.label}>Email</Text>
        <TextInput
          testID="input-email"
          style={styles.input}
          placeholder="seu@email.com"
          placeholderTextColor="#AAAAAA"
          keyboardType="email-address"
          autoCapitalize="none"
          value={email}
          onChangeText={setEmail}
          accessibilityLabel="Email"
          textContentType="emailAddress"
          autoComplete="email"
        />

        <Text style={styles.label}>Senha</Text>
        <View style={styles.inputWithIcon}>
          <TextInput
            testID="input-senha"
            style={styles.inputPassword}
            placeholder="Minimo 6 caracteres"
            placeholderTextColor="#AAAAAA"
            secureTextEntry={!showPassword}
            value={password}
            onChangeText={setPassword}
            onFocus={() => {
              setPasswordFocused(true);
              scrollPasswordFieldIntoView();
            }}
            onBlur={() => setPasswordFocused(false)}
            accessibilityLabel="Senha"
            textContentType="newPassword"
            autoComplete="password-new"
          />
          <TouchableOpacity
            onPress={() => setShowPassword((prev) => !prev)}
            hitSlop={A11Y_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
          >
            <MaterialCommunityIcons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color="#AAAAAA"
            />
          </TouchableOpacity>
        </View>
        {passwordFocused ? (
          <View
            style={styles.passwordRulesBox}
            accessibilityRole="summary"
            accessibilityLabel="Requisitos da senha"
          >
            <Text style={styles.passwordRulesTitle}>Requisitos da senha</Text>

            <View style={styles.passwordRuleRow}>
              <MaterialCommunityIcons
                name={passwordRules.minLen ? 'check-circle' : 'circle-outline'}
                size={16}
                color={passwordRules.minLen ? '#22c55e' : '#94A3B8'}
              />
              <Text
                style={[
                  styles.passwordRuleText,
                  passwordRules.minLen && styles.passwordRuleTextOk,
                ]}
              >
                Mínimo de 8 caracteres
              </Text>
            </View>

            <View style={styles.passwordRuleRow}>
              <MaterialCommunityIcons
                name={passwordRules.hasSpecial ? 'check-circle' : 'circle-outline'}
                size={16}
                color={passwordRules.hasSpecial ? '#22c55e' : '#94A3B8'}
              />
              <Text
                style={[
                  styles.passwordRuleText,
                  passwordRules.hasSpecial && styles.passwordRuleTextOk,
                ]}
              >
                Pelo menos 1 caractere especial
              </Text>
            </View>

            <View style={styles.passwordRuleRow}>
              <MaterialCommunityIcons
                name={passwordRules.hasNumber ? 'check-circle' : 'circle-outline'}
                size={16}
                color={passwordRules.hasNumber ? '#22c55e' : '#94A3B8'}
              />
              <Text
                style={[
                  styles.passwordRuleText,
                  passwordRules.hasNumber && styles.passwordRuleTextOk,
                ]}
              >
                Pelo menos 1 número
              </Text>
            </View>
          </View>
        ) : null}

        <Text style={styles.label}>Confirmar senha</Text>
        <View style={styles.inputWithIcon}>
          <TextInput
            testID="input-confirma-senha"
            style={styles.inputPassword}
            placeholder="Confirme sua senha"
            placeholderTextColor="#AAAAAA"
            secureTextEntry={!showConfirmPassword}
            value={confirmPassword}
            onChangeText={setConfirmPassword}
            onFocus={() => {
              confirmPasswordFocusedRef.current = true;
              scrollConfirmPasswordIntoView();
            }}
            onBlur={() => {
              confirmPasswordFocusedRef.current = false;
            }}
            accessibilityLabel="Confirmar senha"
            textContentType="newPassword"
          />
          {passwordsMatch ? (
            <MaterialCommunityIcons
              name="check-circle"
              size={20}
              color="#22c55e"
              style={styles.passwordCheckIcon}
            />
          ) : null}
          <TouchableOpacity
            onPress={() => setShowConfirmPassword((prev) => !prev)}
            hitSlop={A11Y_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel={showConfirmPassword ? 'Ocultar confirmação de senha' : 'Mostrar confirmação de senha'}
          >
            <MaterialCommunityIcons
              name={showConfirmPassword ? 'eye-off-outline' : 'eye-outline'}
              size={20}
              color="#AAAAAA"
            />
          </TouchableOpacity>
        </View>
        {!passwordsMatch && confirmPassword.length > 0 ? (
          <Text style={styles.passwordMismatchText}>As senhas não coincidem</Text>
        ) : null}

        <Text style={styles.label}>A que grupo voce pertence?</Text>
        <View ref={groupRef} collapsable={false}>
          <TouchableOpacity
            style={[
              styles.selectBox,
              !!disabilityType && styles.selectBoxHasValue,
              menu === 'group' && styles.selectBoxFocused,
            ]}
            onPress={() => openMenu('group', groupRef)}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Grupo de acessibilidade"
            accessibilityHint="Abre lista: deficiência visual, cadeirante ou mobilidade reduzida"
            accessibilityState={{ expanded: menu === 'group' }}
          >
            <View style={styles.selectBoxLeft}>
              {disabilityType ? (
                <>
                  <MaterialCommunityIcons
                    name={
                      DISABILITY_OPTIONS.find((o) => o.value === disabilityType)?.icon ??
                      'help-circle-outline'
                    }
                    size={20}
                    color="#0057A8"
                  />
                  <Text style={[styles.selectBoxValue, styles.selectBoxValueBlue]}>
                    {disabilityLabel}
                  </Text>
                </>
              ) : (
                <Text style={styles.selectPlaceholder}>Selecione</Text>
              )}
            </View>
            <MaterialCommunityIcons
              name={menu === 'group' ? 'chevron-up' : 'chevron-down'}
              size={22}
              color="#AAAAAA"
            />
          </TouchableOpacity>
        </View>
        <View style={styles.fieldSpacer} />

        <TouchableOpacity
          style={[
            styles.continueButton,
            (!passwordsMatch || loading) && styles.continueButtonDisabled,
          ]}
          onPress={handleSubmit}
          disabled={loading || !passwordsMatch}
          accessibilityRole="button"
          accessibilityLabel={loading ? 'Carregando cadastro' : 'Continuar cadastro'}
          accessibilityState={{ disabled: loading || !passwordsMatch }}
        >
          <Text style={styles.continueText}>{loading ? 'Carregando...' : 'Continue'}</Text>
        </TouchableOpacity>
      </ScrollView>

      <Modal visible={menu !== null && anchor !== null} transparent animationType="fade">
        <View style={styles.modalRoot}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={closeMenu}
            accessibilityLabel="Fechar menu"
            accessibilityRole="button"
          />
          {anchor && menu ? (
            <View
              style={[
                styles.menuPanel,
                {
                  left: anchor.x,
                  width: anchor.width,
                  top: anchor.top,
                  maxHeight: anchor.listHeight,
                },
              ]}
              pointerEvents="box-none"
            >
              {menu === 'group'
                ? renderMenuRows(DISABILITY_OPTIONS, disabilityType, (v) =>
                    setDisabilityType(v as DisabilityType),
                  )
                : null}
            </View>
          ) : null}
        </View>
      </Modal>

      <Modal visible={showAvatarAccessModal} transparent animationType="fade">
        <View style={styles.modalRoot}>
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={() => setShowAvatarAccessModal(false)}
            accessibilityLabel="Fechar"
            accessibilityRole="button"
          />
          <View style={styles.avatarAccessPanel}>
            <Text style={styles.avatarAccessTitle}>Permitir acesso à galeria?</Text>
            <Text style={styles.avatarAccessSubtitle}>
              Escolha como deseja liberar o acesso para trocar seu avatar.
            </Text>
            <TouchableOpacity
              style={styles.avatarAccessPrimaryBtn}
              activeOpacity={0.85}
              onPress={() => handlePickAvatar('full')}
              accessibilityRole="button"
              accessibilityLabel="Permitir acesso total à galeria de fotos"
            >
              <Text style={styles.avatarAccessPrimaryText}>Permitir tudo</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.avatarAccessSecondaryBtn}
              activeOpacity={0.85}
              onPress={() => handlePickAvatar('limited')}
              accessibilityRole="button"
              accessibilityLabel="Permitir acesso restrito à galeria de fotos"
            >
              <Text style={styles.avatarAccessSecondaryText}>Permitir de forma restrita</Text>
            </TouchableOpacity>
            <TouchableOpacity
              activeOpacity={0.85}
              onPress={() => setShowAvatarAccessModal(false)}
              accessibilityRole="button"
              accessibilityLabel="Cancelar alteração de foto"
            >
              <Text style={styles.avatarAccessCancelText}>Cancelar</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  formScroll: {
    flex: 1,
  },
  form: {
    paddingHorizontal: 24,
    paddingTop: 12,
    paddingBottom: 40,
    flexGrow: 1,
  },
  backButton: {
    alignSelf: 'flex-start',
    marginBottom: 12,
    paddingVertical: 4,
    paddingRight: 8,
  },
  avatarWrap: {
    alignItems: 'center',
    marginBottom: 32,
  },
  avatarCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#D9D9D9',
    position: 'relative',
  },
  avatarImage: {
    width: '100%',
    height: '100%',
    borderRadius: 40,
  },
  editBadge: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#0057A8',
    position: 'absolute',
    right: -2,
    bottom: -2,
    zIndex: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  label: {
    color: '#1E1D1D',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    fontFamily: 'Agrandir-TextBold',
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: PRIMARY,
    borderRadius: 8,
    height: 52,
    paddingHorizontal: 16,
    fontSize: 14,
    color: '#1E1D1D',
    marginBottom: 16,
    fontFamily: 'Agrandir-Regular',
  },
  inputWithIcon: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: PRIMARY,
    borderRadius: 8,
    height: 52,
    paddingHorizontal: 16,
    marginBottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputPassword: {
    flex: 1,
    color: '#1E1D1D',
    fontSize: 14,
    fontFamily: 'Agrandir-Regular',
  },
  selectBox: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: PRIMARY,
    borderRadius: 8,
    height: 52,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectBoxHasValue: {
    borderColor: PRIMARY,
    backgroundColor: '#EBF3FF',
  },
  selectBoxFocused: {
    borderColor: PRIMARY,
  },
  selectBoxLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  selectPlaceholder: {
    color: '#AAAAAA',
    fontSize: 14,
    fontFamily: 'Agrandir-Regular',
  },
  selectBoxValue: {
    fontSize: 14,
    marginLeft: 12,
    fontFamily: 'Agrandir-Regular',
  },
  selectBoxValueBlue: {
    color: '#0057A8',
    fontWeight: '600',
  },
  fieldSpacer: {
    height: 16,
  },
  continueButton: {
    backgroundColor: PRIMARY,
    borderWidth: 1,
    borderColor: PRIMARY,
    borderRadius: 40,
    height: 52,
    marginTop: 8,
    alignItems: 'center',
    justifyContent: 'center',
  },
  continueButtonDisabled: {
    opacity: 0.5,
  },
  passwordCheckIcon: {
    marginRight: 8,
  },
  passwordMismatchText: {
    color: '#EF4444',
    fontSize: 12,
    marginTop: -10,
    marginBottom: 12,
  },
  passwordRulesBox: {
    marginTop: -6,
    marginBottom: 14,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
  },
  passwordRulesTitle: {
    color: '#111827',
    fontSize: 12,
    marginBottom: 8,
    fontFamily: 'Agrandir-TextBold',
  },
  passwordRuleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
  },
  passwordRuleText: {
    color: '#64748B',
    fontSize: 12,
    fontFamily: 'Agrandir-Regular',
  },
  passwordRuleTextOk: {
    color: '#16A34A',
    fontFamily: 'Agrandir-TextBold',
  },
  continueText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontFamily: 'Agrandir-Regular',
  },
  modalRoot: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
  },
  menuPanel: {
    position: 'absolute',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: PRIMARY,
    overflow: 'hidden',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  menuRow: {
    height: ROW_H,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
  },
  menuRowBorder: {
    borderBottomWidth: 1,
    borderBottomColor: '#E0E0E0',
  },
  menuRowSelected: {
    backgroundColor: '#EBF3FF',
  },
  menuRowText: {
    color: '#1E1D1D',
    fontSize: 14,
    marginLeft: 12,
    fontFamily: 'Agrandir-Regular',
  },
  menuRowTextSelected: {
    color: '#0057A8',
    fontWeight: '600',
  },
  avatarAccessPanel: {
    marginTop: 'auto',
    marginHorizontal: 16,
    marginBottom: 'auto',
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  avatarAccessTitle: {
    color: '#1E1D1D',
    fontSize: 16,
    fontFamily: 'Agrandir-TextBold',
  },
  avatarAccessSubtitle: {
    color: '#64748B',
    fontSize: 13,
    lineHeight: 18,
    fontFamily: 'Agrandir-Regular',
  },
  avatarAccessPrimaryBtn: {
    height: 44,
    borderRadius: 999,
    backgroundColor: '#0057A8',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  avatarAccessPrimaryText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontFamily: 'Agrandir-TextBold',
  },
  avatarAccessSecondaryBtn: {
    height: 44,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: '#0057A8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarAccessSecondaryText: {
    color: '#0057A8',
    fontSize: 14,
    fontFamily: 'Agrandir-TextBold',
  },
  avatarAccessCancelText: {
    color: '#6B7280',
    textAlign: 'center',
    fontSize: 13,
    marginTop: 2,
    fontFamily: 'Agrandir-Regular',
  },
});
