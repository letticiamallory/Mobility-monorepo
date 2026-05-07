import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
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
import { verifyResetCode } from '../services/auth.service';

export default function ResetCodeScreen() {
  const router = useRouter();
  const sx = useAccessibilitySurfaces();
  const params = useLocalSearchParams<{ email?: string | string[] }>();
  const emailParam = Array.isArray(params.email) ? params.email[0] : params.email;
  const [userEmail, setUserEmail] = useState((emailParam ?? '').trim());
  const [digits, setDigits] = useState(['', '', '', '', '', '']);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);
  const inputsRef = useRef<Array<TextInput | null>>([]);

  useEffect(() => {
    setUserEmail((emailParam ?? '').trim());
  }, [emailParam]);

  const handleDigitChange = (text: string, index: number) => {
    const char = text.slice(-1);
    const next = [...digits];
    next[index] = char;
    setDigits(next);
    if (confirmError) setConfirmError(null);
    if (char && index < 5) inputsRef.current[index + 1]?.focus();
  };

  const handleKeyPress = (event: { nativeEvent: { key: string } }, index: number) => {
    if (event.nativeEvent.key === 'Backspace' && !digits[index] && index > 0) {
      inputsRef.current[index - 1]?.focus();
    }
  };

  const handleConfirm = async () => {
    const email = userEmail.trim();
    const code = digits.join('');
    setConfirmError(null);
    if (!email) {
      setConfirmError('Email inválido para recuperação.');
      return;
    }
    if (code.length < 6) {
      setConfirmError('Digite o código completo.');
      return;
    }
    try {
      setConfirming(true);
      const data = await verifyResetCode(email, code);
      const resetToken = `${data.reset_token ?? ''}`.trim();
      if (!resetToken) {
        setConfirmError('Resposta inválida do servidor. Solicite um novo código.');
        return;
      }
      router.replace({
        pathname: '/reset-password',
        params: { email, resetToken },
      });
    } catch (error: unknown) {
      setConfirmError(error instanceof Error ? error.message : 'Não foi possível validar o código.');
    } finally {
      setConfirming(false);
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

          <Text style={styles.title}>Digite o código</Text>
          <Text style={styles.subtitle}>Enviamos um código de 6 dígitos para</Text>
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
            style={[styles.confirmButton, confirming ? styles.confirmButtonDisabled : null]}
            onPress={handleConfirm}
            disabled={confirming}
            accessibilityRole="button"
            accessibilityLabel={confirming ? 'Validando código' : 'Confirmar código'}
            accessibilityState={{ disabled: confirming }}
          >
            <Text style={styles.confirmText}>{confirming ? 'Validando...' : 'Confirmar'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  content: {
    paddingHorizontal: 24,
    paddingTop: 156,
    paddingBottom: 24,
    alignItems: 'center',
  },
  backBtn: { alignSelf: 'flex-start', marginBottom: 24 },
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
    marginTop: 24,
    fontFamily: 'Agrandir-TextBold',
  },
  subtitle: { color: '#666666', fontSize: 14, lineHeight: 22, textAlign: 'center' },
  email: { color: '#0057A8', fontSize: 14, fontWeight: '700', marginTop: 6, textAlign: 'center' },
  codeRow: { flexDirection: 'row', gap: 10, marginTop: 24 },
  codeInput: {
    width: 44,
    height: 54,
    borderRadius: 12,
    backgroundColor: '#F5F5F5',
    fontSize: 16,
    color: '#1E1D1D',
    borderWidth: 1,
    borderColor: 'transparent',
  },
  codeInputFocused: { borderColor: '#0057A8' },
  errorText: { color: '#DC2626', fontSize: 13, marginTop: 12, textAlign: 'center' },
  confirmButton: {
    backgroundColor: '#0057A8',
    borderRadius: 40,
    height: 52,
    marginTop: 18,
    alignSelf: 'stretch',
    marginHorizontal: -6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  confirmButtonDisabled: { opacity: 0.7 },
  confirmText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
});

