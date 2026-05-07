import { Stack, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import {
  Alert,
  Animated,
  Image,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScaledText as Text } from '@/components/ScaledText';
import { ScaledTextInput as TextInput } from '@/components/ScaledTextInput';
import {
  useAccessibilityPreferences,
  useAccessibilitySurfaces,
} from '@/contexts/accessibility-preferences';
import { A11Y_HIT_SLOP } from '@/constants/accessibility';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { GoogleAuthErrorBoundary, GoogleLoginSection } from '@/components/GoogleLoginSection';
import { login } from '../services/auth.service';
import { API_URL } from '../constants/api';
import { isGoogleLoginEnabled } from '../services/google-auth.service';
import {
  clearAllMobilityStorage,
  getRememberMe,
  getStoredTokenOnly,
  saveRememberMe,
  saveToken,
  saveUserInfo,
} from '../services/token.service';

export default function LoginScreen() {
  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <LoginScreenInner />
    </>
  );
}

/** Exportado para testes (RTL). */
export function LoginScreenInner() {
  const { highContrast, colors } = useAccessibilityPreferences();
  const sx = useAccessibilitySurfaces();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loadingEmail, setLoadingEmail] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(true);
  const router = useRouter();
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const remember = await getRememberMe();
      if (cancelled) return;
      setRememberMe(remember);
      if (!remember) return;
      // Só JWT real guardado (nunca sessão fictícia).
      const token = await getStoredTokenOnly();
      if (cancelled) return;
      if (token) {
        router.replace('/home');
      }
    })();

    const pulse = (dot: Animated.Value, delay: number) =>
      Animated.sequence([
        Animated.delay(delay),
        Animated.timing(dot, { toValue: 1, duration: 300, useNativeDriver: true }),
        Animated.timing(dot, { toValue: 0.3, duration: 300, useNativeDriver: true }),
      ]);

    Animated.loop(
      Animated.parallel([
        pulse(dot1, 0),
        pulse(dot2, 200),
        pulse(dot3, 400),
      ])
    ).start();
    return () => {
      cancelled = true;
    };
  }, [router]);

  const handleLogin = async () => {
    const emailTrimmed = email.trim();
    if (!emailTrimmed || !password) {
      Alert.alert('Atenção', 'Preencha o email e a senha');
      return;
    }

    try {
      setLoadingEmail(true);
      const loginData = await login(emailTrimmed, password);
      await saveRememberMe(rememberMe);
      await saveToken(loginData.access_token);
      await saveUserInfo(loginData.user_id, loginData.name, emailTrimmed.toLowerCase());
      router.replace('/home');
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Não foi possível entrar. Tente de novo.';

      /**
       * Backend lança “Email não verificado…” quando o usuário ainda não confirmou o
       * código por e-mail. Neste caso, oferecemos ação direta para a tela de verificação,
       * em vez de só mostrar a string genérica.
       */
      const lower = message.toLowerCase();
      const needsVerification =
        lower.includes('email não verificado') ||
        lower.includes('e-mail não verificado') ||
        lower.includes('verifique sua caixa') ||
        lower.includes('verifique seu email');

      if (needsVerification) {
        Alert.alert(
          'Verifique seu e-mail',
          'Sua conta ainda não foi confirmada. Quer abrir a tela de verificação?',
          [
            { text: 'Agora não', style: 'cancel' },
            {
              text: 'Verificar',
              onPress: () =>
                router.push({
                  pathname: '/email-confirmation',
                  params: { email: emailTrimmed.toLowerCase() },
                }),
            },
          ],
        );
      } else {
        Alert.alert('Erro', message);
      }
    } finally {
      setLoadingEmail(false);
    }
  };

  const loginScreenBg = highContrast ? { backgroundColor: colors.screenBackground } : null;

  return (
    <SafeAreaView style={[styles.container, loginScreenBg]} edges={['top', 'left', 'right', 'bottom']}>
      <KeyboardAvoidingView
        style={[styles.container, loginScreenBg]}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          style={styles.scrollView}
          contentContainerStyle={styles.scrollContent}
          scrollEnabled={false}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
          bounces={false}
        >
          <View style={[styles.card, sx.fillCard]}>
            <Image
              source={require('../assets/images/mobility_m_blue.png')}
              style={styles.logo}
              resizeMode="contain"
            />
            <View style={styles.routeDotsRow}>
              <Animated.View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#0057A8', opacity: dot1 }} />
              <View style={{ width: 36, height: 2, backgroundColor: '#E0E0E0', borderRadius: 1 }} />
              <Animated.View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#0057A8', opacity: dot2 }} />
              <View style={{ width: 36, height: 2, backgroundColor: '#E0E0E0', borderRadius: 1 }} />
              <Animated.View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: '#0057A8', opacity: dot3 }}>
                <View style={{ width: 4, height: 4, borderRadius: 2, backgroundColor: '#FFFFFF', position: 'absolute', top: 3, left: 3 }} />
              </Animated.View>
            </View>

            <View style={styles.formWrap}>
              <Text style={styles.fieldLabel}>Email</Text>
              <TextInput
                testID="input-email"
                style={styles.input}
                placeholder="Insira seu email"
                placeholderTextColor="#AAAAAA"
                keyboardType="email-address"
                autoCapitalize="none"
                value={email}
                onChangeText={setEmail}
                accessibilityLabel="Email"
                textContentType="emailAddress"
                autoComplete="email"
              />

              <Text style={styles.fieldLabel}>Senha</Text>
              <View style={styles.passwordInputWrap}>
                <TextInput
                  testID="input-senha"
                  style={styles.passwordInput}
                  placeholder="Insira sua senha"
                  placeholderTextColor="#AAAAAA"
                  secureTextEntry={!showPassword}
                  value={password}
                  onChangeText={setPassword}
                  accessibilityLabel="Senha"
                  textContentType="password"
                  autoComplete="password"
                />
                <TouchableOpacity
                  onPress={() => setShowPassword((prev) => !prev)}
                  hitSlop={A11Y_HIT_SLOP}
                  accessibilityRole="button"
                  accessibilityLabel={showPassword ? 'Ocultar senha' : 'Mostrar senha'}
                >
                  <MaterialCommunityIcons
                    name={showPassword ? 'eye-off-outline' : 'eye-outline'}
                    size={22}
                    color="#1E1D1D"
                  />
                </TouchableOpacity>
              </View>

              <View style={styles.rememberRow}>
                <TouchableOpacity
                  style={styles.rememberWrap}
                  activeOpacity={0.8}
                  onPress={() => setRememberMe((v) => !v)}
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: rememberMe }}
                  accessibilityLabel="Lembrar-me neste dispositivo"
                >
                  <View style={styles.checkBox}>
                    {rememberMe ? (
                      <MaterialCommunityIcons name="check" size={14} color="#0057A8" />
                    ) : null}
                  </View>
                  <Text style={styles.rememberText}>Lembrar-me</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  onPress={() => router.push('/forgot-password')}
                  activeOpacity={0.8}
                  accessibilityRole="button"
                  accessibilityLabel="Esqueci minha senha"
                >
                  <Text style={styles.forgotText}>Esqueci minha senha</Text>
                </TouchableOpacity>
              </View>

              <TouchableOpacity
                style={[styles.button, loadingEmail && styles.buttonDisabled]}
                onPress={handleLogin}
                disabled={loadingEmail}
                accessibilityRole="button"
                accessibilityLabel={loadingEmail ? 'Entrando' : 'Entrar'}
                accessibilityState={{ disabled: loadingEmail }}
              >
                <Text style={styles.buttonText}>{loadingEmail ? 'Entrando...' : 'Entrar'}</Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.signupRow}
                onPress={() => router.push('/register')}
                activeOpacity={0.8}
                accessibilityRole="button"
                accessibilityLabel="Não tem conta? Registre-se"
              >
                <Text style={styles.signupText}>
                  Não tem conta? <Text style={styles.signupLink}>Registre-se</Text>
                </Text>
              </TouchableOpacity>

              {isGoogleLoginEnabled() ? (
                <GoogleAuthErrorBoundary>
                  <GoogleLoginSection />
                </GoogleAuthErrorBoundary>
              ) : null}

              <Text style={styles.termsText}>
                Ao entrar, você concorda com os termos{'\n'}e condições.
              </Text>

              {__DEV__ ? (
                <TouchableOpacity
                  style={styles.devClearBtn}
                  onPress={async () => {
                    await clearAllMobilityStorage();
                    Alert.alert('Dev', 'Armazenamento limpo. Tente entrar de novo.');
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Desenvolvimento: limpar armazenamento local do app"
                >
                  <Text style={styles.devClearText}>Limpar dados (dev)</Text>
                </TouchableOpacity>
              ) : null}
            </View>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#EEF2FF',
  },
  scrollView: {
    flex: 1,
  },
  scrollContent: {
    flexGrow: 1,
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 28,
    alignItems: 'center',
    justifyContent: 'flex-start',
  },
  card: {
    width: '100%',
    maxWidth: 430,
    backgroundColor: '#FFFFFF',
    borderRadius: 22,
    marginTop: 8,
    paddingTop: 28,
    paddingBottom: 24,
    paddingHorizontal: 20,
  },
  routeDotsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: -18,
    marginBottom: 24,
    gap: 6,
  },
  logo: {
    width: 120,
    height: 120,
    alignSelf: 'center',
    marginTop: 8,
    marginBottom: 28,
  },
  formWrap: {
    width: '100%',
  },
  fieldLabel: {
    color: '#1E1D1D',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    height: 52,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    paddingHorizontal: 16,
    fontSize: 14,
    color: '#1E1D1D',
    marginBottom: 12,
  },
  passwordInputWrap: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    flexDirection: 'row',
    alignItems: 'center',
    height: 52,
    borderWidth: 1,
    borderColor: '#E0E0E0',
    paddingHorizontal: 16,
    marginBottom: 6,
  },
  passwordInput: {
    flex: 1,
    height: '100%',
    fontSize: 14,
    color: '#1E1D1D',
  },
  rememberRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 2,
    marginBottom: 36,
  },
  rememberWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  checkBox: {
    width: 22,
    height: 22,
    borderRadius: 5,
    borderWidth: 1.5,
    borderColor: '#0057A8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rememberText: {
    color: '#0057A8',
    fontSize: 22 * 0.6,
  },
  forgotText: {
    color: '#0057A8',
    fontSize: 12,
  },
  button: {
    backgroundColor: '#0057A8',
    borderRadius: 26,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 0,
    shadowColor: '#000',
    shadowOpacity: 0.16,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 2 },
    elevation: 3,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '600',
  },
  signupRow: {
    marginTop: 16,
    alignItems: 'center',
  },
  signupText: {
    color: '#666666',
    fontSize: 13,
    textAlign: 'center',
  },
  signupLink: {
    color: '#0057A8',
    fontWeight: '600',
  },
  termsText: {
    color: '#1E1D1D',
    fontSize: 28 * 0.45,
    textAlign: 'center',
    lineHeight: 20,
    marginTop: 20,
    marginBottom: 32,
  },
  title: {
    display: 'none',
  },
  devClearBtn: {
    marginTop: 12,
    alignSelf: 'center',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  devClearText: {
    fontSize: 12,
    color: '#888',
    textDecorationLine: 'underline',
  },
});
