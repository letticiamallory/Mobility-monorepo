import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState, type ElementRef } from 'react';
import {
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
import { useAccessibilitySurfaces } from '@/contexts/accessibility-preferences';
import { A11Y_HIT_SLOP } from '@/constants/accessibility';
import ForgotPasswordSvg from '../assets/images/undraw_forgot-password_nttj (1).svg';
import { API_URL } from '../constants/api';
import { saveRememberMe, saveToken, saveUserInfo } from '../services/token.service';

type CodeDigitInputRef = ElementRef<typeof TextInput>;

export default function EmailConfirmationScreen() {
  const router = useRouter();
  const sx = useAccessibilitySurfaces();
  const params = useLocalSearchParams<{ email?: string | string[] }>();
  const emailParam = Array.isArray(params.email) ? params.email[0] : params.email;
  const [userEmail, setUserEmail] = useState((emailParam ?? '').trim());
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const [resending, setResending] = useState(false);
  const [resendLeftSeconds, setResendLeftSeconds] = useState(0);
  const inputsRef = useRef<Array<CodeDigitInputRef | null>>([]);

  useEffect(() => {
    setUserEmail((emailParam ?? '').trim());
  }, [emailParam]);

  const handleDigitChange = (text: string, index: number) => {
    const char = text.slice(-1);
    const next = [...digits];
    next[index] = char;
    setDigits(next);
    if (confirmError) setConfirmError(null);

    if (char && index < 5) {
      inputsRef.current[index + 1]?.focus();
    }
  };

  const handleKeyPress = (
    event: { nativeEvent: { key: string } },
    index: number,
  ) => {
    if (event.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  const handleConfirm = async () => {
    const email = userEmail.trim();
    const code = digits.join('');
    setConfirmError(null);
    if (!email) {
      setConfirmError('Email inválido para confirmação.');
      return;
    }
    if (code.length < 6) {
      setConfirmError('Digite o código completo.');
      return;
    }

    try {
      setConfirming(true);
      const response = await fetch(`${API_URL}/auth/verify-email`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, code }),
      });
      const data = (await response.json()) as {
        message?: string | string[];
        access_token?: string;
        user_id?: number;
        name?: string;
      };
      if (!response.ok) {
        const msg = Array.isArray(data.message)
          ? data.message.filter(Boolean).join(' ')
          : typeof data.message === 'string'
            ? data.message
            : 'Falha ao verificar';
        setConfirmError(msg);
        return;
      }

      if (!data.access_token || !data.user_id || !data.name) {
        setConfirmError('Resposta inválida do servidor.');
        return;
      }

      await saveRememberMe(true);
      await saveToken(data.access_token);
      await saveUserInfo(data.user_id, data.name, email.toLowerCase());
      router.replace('/home');
    } catch (error: unknown) {
      setConfirmError(error instanceof Error ? error.message : 'Erro ao verificar.');
    } finally {
      setConfirming(false);
    }
  };

  const handleResend = async () => {
    if (resendLeftSeconds > 0) return; // evita clique duplo durante cooldown

    try {
      setResending(true);
      const response = await fetch(`${API_URL}/auth/resend-verification`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: userEmail.trim() }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.message);

      // Feedback silencioso: o usuário vê o cooldown do botão.

      // Inicia cooldown de 60 segundos
      setResendLeftSeconds(60);
      const interval = setInterval(() => {
        setResendLeftSeconds((prev) => {
          if (prev <= 1) {
            clearInterval(interval);
            return 0;
          }
          return prev - 1;
        });
      }, 1000);
    } catch (error: any) {
      setConfirmError(typeof error?.message === 'string' ? error.message : 'Não foi possível reenviar o código.');
    } finally {
      setResending(false);
    }
  };

  return (
    <SafeAreaView style={[styles.safeArea, sx.fillScreen]}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={styles.safeArea}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            hitSlop={A11Y_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Voltar"
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color="#1E1D1D" />
          </TouchableOpacity>
          <View style={styles.illustrationWrap}>
            <ForgotPasswordSvg width={260} height={200} />
          </View>

          <Text style={styles.title}>Verifique seu email</Text>
          <Text style={styles.subtitle}>Enviamos um código de confirmação para</Text>
          <Text style={styles.email}>{userEmail}</Text>

          <View style={styles.codeRow}>
            {digits.map((digit, index) => {
              const isFocused = focusedIndex === index;
              return (
                <TextInput
                  key={`digit-${index}`}
                  ref={(ref) => {
                    inputsRef.current[index] = ref;
                  }}
                  style={[styles.codeInput, isFocused && styles.codeInputFocused]}
                  value={digit}
                  onChangeText={(text) => handleDigitChange(text, index)}
                  onKeyPress={(e) => handleKeyPress(e, index)}
                  onFocus={() => setFocusedIndex(index)}
                  onBlur={() => setFocusedIndex((prev) => (prev === index ? null : prev))}
                  keyboardType="number-pad"
                  maxLength={1}
                  textAlign="center"
                  accessibilityLabel={`Dígito ${index + 1} do código de 6 dígitos`}
                />
              );
            })}
          </View>
          {confirmError ? <Text style={styles.errorText}>{confirmError}</Text> : null}

          <TouchableOpacity
            style={styles.confirmButton}
            onPress={handleConfirm}
            disabled={confirming}
            accessibilityRole="button"
            accessibilityLabel={confirming ? 'Validando código' : 'Confirmar email'}
            accessibilityState={{ disabled: confirming }}
          >
            <Text style={styles.confirmText}>{confirming ? 'Validando...' : 'Confirmar'}</Text>
          </TouchableOpacity>

          <View style={styles.resendRow}>
            <Text style={styles.resendText}>Não recebeu? </Text>
            <TouchableOpacity
              onPress={handleResend}
              disabled={resendLeftSeconds > 0 || resending}
              accessibilityRole="button"
              accessibilityLabel={
                resending
                  ? 'Reenviando código'
                  : resendLeftSeconds > 0
                    ? `Reenviar código em ${resendLeftSeconds} segundos`
                    : 'Reenviar código de confirmação'
              }
              accessibilityState={{ disabled: resendLeftSeconds > 0 || resending }}
            >
              <Text
                style={{
                  color: resendLeftSeconds > 0 ? '#AAAAAA' : '#0057A8',
                  fontSize: 13,
                }}
              >
                {resending
                  ? 'Enviando...'
                  : resendLeftSeconds > 0
                    ? `Reenviar em ${resendLeftSeconds}s`
                    : 'Reenviar código'}
              </Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  content: {
    paddingHorizontal: 24,
    paddingTop: 132,
    paddingBottom: 24,
    alignItems: 'center',
  },
  backBtn: {
    alignSelf: 'flex-start',
    marginBottom: 24,
  },
  illustrationWrap: {
    width: 260,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  title: {
    color: '#1E1D1D',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 0,
    fontFamily: 'Agrandir-TextBold',
  },
  subtitle: {
    color: '#666666',
    fontSize: 14,
    textAlign: 'center',
    marginTop: 8,
    fontFamily: 'Agrandir-Regular',
  },
  email: {
    color: '#0057A8',
    fontWeight: '600',
    marginTop: 4,
    fontFamily: 'Agrandir-TextBold',
  },
  codeRow: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 28,
  },
  codeInput: {
    width: 44,
    height: 54,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#E0E0E0',
    fontSize: 22,
    fontWeight: '600',
    color: '#1E1D1D',
  },
  codeInputFocused: {
    borderColor: '#0057A8',
  },
  errorText: {
    width: '100%',
    marginTop: 12,
    color: '#EF4444',
    fontSize: 13,
    textAlign: 'center',
    fontFamily: 'Agrandir-Regular',
  },
  confirmButton: {
    backgroundColor: '#0057A8',
    borderRadius: 40,
    height: 52,
    width: '100%',
    marginTop: 24,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
    fontFamily: 'Agrandir-TextBold',
  },
  resendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    flexWrap: 'wrap',
    marginTop: 16,
  },
  resendText: {
    color: '#666666',
    fontSize: 13,
    fontFamily: 'Agrandir-Regular',
  },
});
