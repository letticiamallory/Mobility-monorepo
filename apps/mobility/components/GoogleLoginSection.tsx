import { MaterialCommunityIcons } from '@expo/vector-icons';
import * as Google from 'expo-auth-session/providers/google';
import * as WebBrowser from 'expo-web-browser';
import { useRouter } from 'expo-router';
import { Component, type ErrorInfo, type ReactNode, useState } from 'react';
import { Alert, Image, StyleSheet, TouchableOpacity, View } from 'react-native';
import { ScaledText as Text } from '@/components/ScaledText';
import { API_URL } from '@/constants/api';
import { A11Y_HIT_SLOP } from '@/constants/accessibility';
import {
  GOOGLE_WEB_CLIENT_ID,
  googlePayloadFromIdToken,
  isExpoGo,
  signInWithGoogleNative,
} from '@/services/google-auth.service';
import { saveRememberMe, saveToken, saveUserInfo } from '@/services/token.service';

WebBrowser.maybeCompleteAuthSession();

type BoundaryProps = { children: ReactNode };

type BoundaryState = { hasError: boolean };

/**
 * Se o fluxo OAuth falhar de forma irrecuperável na árvore, o formulário email/senha continua intacto.
 */
export class GoogleAuthErrorBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { hasError: false };

  static getDerivedStateFromError(): BoundaryState {
    return { hasError: true };
  }

  componentDidCatch(_error: Error, _info: ErrorInfo): void {
    /* boundary: formulário email/senha permanece utilizável */
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <View style={styles.fallbackBox}>
          <MaterialCommunityIcons name="alert-circle-outline" size={20} color="#B45309" />
          <Text style={styles.fallbackText}>
            Login com Google indisponível neste momento. Use email e senha ou tente mais tarde.
          </Text>
        </View>
      );
    }
    return this.props.children;
  }
}

export function GoogleLoginSection() {
  const router = useRouter();
  const [loadingGoogle, setLoadingGoogle] = useState(false);

  const [googleRequest, , googlePromptAsync] = Google.useIdTokenAuthRequest({
    webClientId: GOOGLE_WEB_CLIENT_ID,
    clientId: GOOGLE_WEB_CLIENT_ID,
  });

  const handleGoogleLogin = async () => {
    try {
      setLoadingGoogle(true);
      let googleData: {
        email: string;
        name: string;
        googleId: string;
        token: string;
      };

      if (isExpoGo()) {
        if (!googleRequest) {
          throw new Error('Login Google ainda não está pronto. Tente de novo em um instante.');
        }
        const result = await googlePromptAsync();
        if (result.type === 'cancel' || result.type === 'dismiss') return;
        if (result.type !== 'success') {
          const err =
            result.type === 'error'
              ? String(result.params?.error_description ?? result.error ?? 'Falha no login Google')
              : 'Falha no login Google';
          throw new Error(err);
        }
        const idToken = result.params.id_token ?? result.authentication?.idToken ?? '';
        if (!idToken) {
          throw new Error(
            'Não foi possível obter o token do Google. Confira o redirect URI no Google Cloud (cliente Web OAuth).',
          );
        }
        googleData = googlePayloadFromIdToken(idToken);
      } else {
        googleData = await signInWithGoogleNative();
      }

      if (!googleData.email || !googleData.googleId || !googleData.token) {
        throw new Error(
          'Não foi possível obter os dados da conta Google. Verifique no Google Cloud o Web Client ID e SHA-1 do app.',
        );
      }

      const url = `${API_URL}/auth/google`;
      let response: Response;
      try {
        response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(googleData),
        });
      } catch {
        throw new Error(
          `Não foi possível conectar à API (${API_URL}). Confira EXPO_PUBLIC_API_URL e se o backend está acessível.`,
        );
      }

      const text = await response.text();

      let data: {
        access_token?: string;
        user_id?: number;
        name?: string;
        message?: string | string[];
      } = {};
      try {
        data = text ? (JSON.parse(text) as typeof data) : {};
      } catch {
        if (!response.ok) {
          throw new Error(
            `Login Google recusado (HTTP ${response.status}). Resposta não é JSON — veja logs do servidor.`,
          );
        }
      }
      if (!response.ok) {
        const detail = Array.isArray(data.message)
          ? data.message.filter(Boolean).join(' ')
          : data.message;
        throw new Error(detail || `Falha no login com Google (HTTP ${response.status}).`);
      }
      if (!data.access_token || !data.user_id || !data.name) {
        throw new Error('Resposta inválida no login com Google.');
      }

      await saveRememberMe(true);
      await saveToken(data.access_token);
      await saveUserInfo(data.user_id, data.name, googleData.email);
      router.replace('/home');
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : 'Não foi possível entrar com Google.';
      Alert.alert('Erro', message);
    } finally {
      setLoadingGoogle(false);
    }
  };

  return (
    <>
      <View style={styles.dividerRow}>
        <View style={styles.dividerLine} />
        <View style={styles.withCircle}>
          <Text style={styles.withText}>Com</Text>
        </View>
        <View style={styles.dividerLine} />
      </View>

      <TouchableOpacity
        activeOpacity={0.85}
        style={[
          styles.googleSignInButton,
          (loadingGoogle || (isExpoGo() && !googleRequest)) && styles.googleSignInButtonDisabled,
        ]}
        onPress={() => {
          void handleGoogleLogin();
        }}
        disabled={loadingGoogle || (isExpoGo() && !googleRequest)}
        accessibilityRole="button"
        accessibilityLabel="Conectar-se com o Google"
        hitSlop={A11Y_HIT_SLOP}
      >
        <Image
          source={{ uri: 'https://www.gstatic.com/images/branding/product/1x/googleg_48dp.png' }}
          style={styles.googleSignInIcon}
          resizeMode="contain"
        />
        <Text style={styles.googleSignInLabel}>
          {loadingGoogle ? 'Conectando…' : 'Conectar-se com o Google'}
        </Text>
      </TouchableOpacity>
    </>
  );
}

const styles = StyleSheet.create({
  dividerRow: {
    marginTop: 24,
    marginBottom: 24,
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E0E0E0',
  },
  withCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    borderWidth: 1,
    borderColor: '#1E1D1D',
    alignItems: 'center',
    justifyContent: 'center',
    marginHorizontal: 10,
  },
  withText: { color: '#1E1D1D', fontSize: 20 * 0.6 },
  googleSignInButton: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    minHeight: 52,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 26,
    borderWidth: 1,
    borderColor: '#747775',
    backgroundColor: '#FFFFFF',
    marginBottom: 24,
    gap: 12,
  },
  googleSignInButtonDisabled: {
    opacity: 0.55,
  },
  googleSignInIcon: {
    width: 20,
    height: 20,
  },
  googleSignInLabel: {
    fontSize: 15,
    fontWeight: '500',
    color: '#1F1F1F',
    letterSpacing: 0.15,
  },
  fallbackBox: {
    marginTop: 16,
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    padding: 12,
    borderRadius: 10,
    backgroundColor: '#FFFBEB',
    borderWidth: 1,
    borderColor: '#FCD34D',
  },
  fallbackText: {
    flex: 1,
    fontSize: 13,
    color: '#92400E',
    lineHeight: 18,
  },
});
