import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import { resetPassword } from '../services/auth.service';
import { ScaledText as Text } from '@/components/ScaledText';
import { ScaledTextInput as TextInput } from '@/components/ScaledTextInput';
import { useAccessibilitySurfaces } from '@/contexts/accessibility-preferences';
import { A11Y_HIT_SLOP } from '@/constants/accessibility';
import SecureLoginSvg from '../assets/images/undraw_secure-login_m11a.svg';

export default function ResetPasswordScreen() {
  const router = useRouter();
  const sx = useAccessibilitySurfaces();
  const params = useLocalSearchParams<{ email?: string | string[]; resetToken?: string | string[] }>();
  const email = (Array.isArray(params.email) ? params.email[0] : params.email) ?? '';
  const resetToken =
    (Array.isArray(params.resetToken) ? params.resetToken[0] : params.resetToken) ?? '';

  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [passwordFocused, setPasswordFocused] = useState(false);
  const [successVisible, setSuccessVisible] = useState(false);
  const redirectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (redirectTimerRef.current) clearTimeout(redirectTimerRef.current);
    };
  }, []);

  const passwordRules = useMemo(() => {
    const p = newPassword ?? '';
    return {
      minLen: p.length >= 8,
      hasSpecial: /[^A-Za-z0-9]/.test(p),
      hasNumber: /\d/.test(p),
    };
  }, [newPassword]);

  const passwordsMatch = confirmPassword.length === 0 ? true : newPassword === confirmPassword;
  const canSubmit =
    !loading &&
    !!email.trim() &&
    !!resetToken.trim() &&
    passwordRules.minLen &&
    passwordRules.hasSpecial &&
    passwordRules.hasNumber &&
    newPassword === confirmPassword;

  const handleSubmit = async () => {
    if (!email || !resetToken) {
      Alert.alert('Erro', 'Sessão inválida. Solicite um novo código.');
      router.replace('/forgot-password');
      return;
    }
    if (!passwordRules.minLen || !passwordRules.hasSpecial || !passwordRules.hasNumber) {
      Alert.alert('Atenção', 'Crie uma senha que atenda aos requisitos.');
      return;
    }
    if (newPassword !== confirmPassword) {
      Alert.alert('Atenção', 'As senhas não coincidem.');
      return;
    }
    try {
      setLoading(true);
      await resetPassword(email, resetToken, newPassword, confirmPassword);
      setSuccessVisible(true);
      redirectTimerRef.current = setTimeout(() => {
        setSuccessVisible(false);
        router.replace('/login');
      }, 1200);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Não foi possível redefinir sua senha.';
      Alert.alert('Erro', message);
    } finally {
      setLoading(false);
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
            <SecureLoginSvg width={260} height={200} />
          </View>

          <Text style={styles.title}>Criar nova senha</Text>
          <Text style={styles.subtitle}>Defina uma nova senha para acessar sua conta com segurança.</Text>

          <Text style={styles.label}>Nova senha</Text>
          <View style={styles.inputWithIcon}>
            <TextInput
              style={styles.inputPassword}
              value={newPassword}
              onChangeText={setNewPassword}
              placeholder="Digite a nova senha"
              placeholderTextColor="#AAAAAA"
              secureTextEntry={!showPassword}
              onFocus={() => setPasswordFocused(true)}
              onBlur={() => setPasswordFocused(false)}
              accessibilityLabel="Nova senha"
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
              style={styles.inputPassword}
              value={confirmPassword}
              onChangeText={setConfirmPassword}
              placeholder="Repita a nova senha"
              placeholderTextColor="#AAAAAA"
              secureTextEntry={!showConfirmPassword}
              accessibilityLabel="Confirmar nova senha"
              textContentType="newPassword"
            />
            {passwordsMatch && confirmPassword.length > 0 ? (
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

          <TouchableOpacity
            style={[styles.saveBtn, !canSubmit ? styles.saveBtnDisabled : null]}
            onPress={handleSubmit}
            disabled={!canSubmit}
            accessibilityRole="button"
            accessibilityLabel={loading ? 'Salvando nova senha' : 'Salvar nova senha'}
            accessibilityState={{ disabled: !canSubmit }}
          >
            <Text style={styles.saveBtnText}>{loading ? 'Salvando...' : 'Salvar nova senha'}</Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>

      <Modal transparent animationType="fade" visible={successVisible}>
        <View style={styles.successBackdrop} accessibilityLiveRegion="polite">
          <View style={styles.successCard}>
            <MaterialCommunityIcons name="check-circle" size={44} color="#22c55e" />
            <Text style={styles.successTitle}>Senha alterada</Text>
            <Text style={styles.successText}>Você já pode fazer login com sua nova senha.</Text>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#FFFFFF' },
  content: { paddingHorizontal: 24, paddingTop: 96, paddingBottom: 24 },
  backBtn: { alignSelf: 'flex-start', marginBottom: 18 },
  illustrationWrap: {
    width: 260,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 18,
  },
  title: { color: '#1E1D1D', fontSize: 24, fontWeight: '700' },
  subtitle: { color: '#64748B', fontSize: 14, marginTop: 8, lineHeight: 20 },
  label: { color: '#1E1D1D', fontSize: 13, fontWeight: '600', marginTop: 18, marginBottom: 6 },
  inputWithIcon: {
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    height: 52,
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
  },
  inputPassword: { flex: 1, color: '#1E1D1D', fontSize: 14 },
  passwordCheckIcon: { marginRight: 8 },
  passwordMismatchText: { color: '#DC2626', fontSize: 12, marginTop: 6 },
  passwordRulesBox: {
    width: '100%',
    backgroundColor: '#F8FAFC',
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 12,
    marginTop: 10,
  },
  passwordRulesTitle: { color: '#0F172A', fontSize: 13, fontWeight: '700', marginBottom: 10 },
  passwordRuleRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 8 },
  passwordRuleText: { color: '#475569', fontSize: 13, flex: 1 },
  passwordRuleTextOk: { color: '#16A34A' },
  saveBtn: {
    marginTop: 24,
    backgroundColor: '#0057A8',
    borderRadius: 40,
    height: 52,
    alignItems: 'center',
    justifyContent: 'center',
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#FFFFFF', fontWeight: '700', fontSize: 15 },
  successBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  successCard: {
    width: '100%',
    maxWidth: 360,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    paddingVertical: 18,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  successTitle: { color: '#0F172A', fontSize: 16, fontWeight: '800', marginTop: 10 },
  successText: { color: '#475569', fontSize: 13, textAlign: 'center', marginTop: 6, lineHeight: 18 },
});
