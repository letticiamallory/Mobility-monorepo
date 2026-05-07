import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { useReduceMotion } from '@/hooks/useReduceMotion';
import {
  Alert,
  Animated,
  KeyboardAvoidingView,
  Platform,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  TouchableOpacity,
  View,
} from 'react-native';
import MailIllustration from '../assets/images/mail.svg';
import { ScaledText as Text } from '@/components/ScaledText';
import { ScaledTextInput as TextInput } from '@/components/ScaledTextInput';
import { useAccessibilitySurfaces } from '@/contexts/accessibility-preferences';
import { A11Y_HIT_SLOP } from '@/constants/accessibility';
import { forgotPassword } from '../services/auth.service';

export default function ForgotPasswordScreen() {
  const router = useRouter();
  const sx = useAccessibilitySurfaces();
  const params = useLocalSearchParams<{ email?: string | string[] }>();
  const emailFromParams = useRef(
    Array.isArray(params.email) ? params.email[0] ?? '' : params.email ?? '',
  ).current;
  const [email, setEmail] = useState(emailFromParams);
  const [loading, setLoading] = useState(false);
  const reduceMotion = useReduceMotion();
  const entryTranslateY = useRef(new Animated.Value(40)).current;
  const entryOpacity = useRef(new Animated.Value(0)).current;
  const floatY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (reduceMotion) {
      entryTranslateY.setValue(0);
      entryOpacity.setValue(1);
      floatY.setValue(0);
      return;
    }
    Animated.parallel([
      Animated.spring(entryTranslateY, {
        toValue: 0,
        useNativeDriver: true,
        friction: 8,
        tension: 60,
      }),
      Animated.spring(entryOpacity, {
        toValue: 1,
        useNativeDriver: true,
        friction: 8,
        tension: 60,
      }),
    ]).start(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(floatY, {
            toValue: -8,
            duration: 1200,
            useNativeDriver: true,
          }),
          Animated.timing(floatY, {
            toValue: 0,
            duration: 1200,
            useNativeDriver: true,
          }),
        ]),
      ).start();
    });
  }, [reduceMotion, entryOpacity, entryTranslateY, floatY]);

  const handleSendCode = async () => {
    if (!email.trim()) {
      Alert.alert('Atenção', 'Digite seu email cadastrado.');
      return;
    }
    try {
      setLoading(true);
      await forgotPassword(email.trim());
      router.push({
        pathname: '/reset-code',
        params: { email: email.trim() },
      });
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Não foi possível enviar o código.';
      Alert.alert('Erro', message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaView style={[styles.screen, sx.fillScreen]}>
      <Stack.Screen options={{ headerShown: false }} />
      <KeyboardAvoidingView
        style={styles.screen}
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 8 : 0}
      >
        <ScrollView
          contentContainerStyle={styles.content}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <TouchableOpacity
            onPress={() => router.back()}
            style={styles.backBtn}
            hitSlop={A11Y_HIT_SLOP}
            accessibilityRole="button"
            accessibilityLabel="Voltar"
          >
            <MaterialCommunityIcons name="arrow-left" size={24} color="#1E1D1D" />
          </TouchableOpacity>

          <Animated.View
            style={[
              styles.illustrationWrap,
              {
                opacity: entryOpacity,
                transform: [{ translateY: entryTranslateY }, { translateY: floatY }],
              },
            ]}
          >
            <MailIllustration width={260} height={200} />
          </Animated.View>
          <Text style={styles.title}>Insira seu e-mail</Text>
          <Text style={styles.subtitle}>
            Informe seu e-mail cadastrado e enviaremos um link para você criar uma nova senha
          </Text>

          <Text style={styles.label}>Email</Text>
          <View style={styles.inputWrap}>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder="Digite seu email"
              placeholderTextColor="#AAAAAA"
              keyboardType="email-address"
              autoCapitalize="none"
              accessibilityLabel="Email"
              textContentType="emailAddress"
              autoComplete="email"
            />
            <MaterialCommunityIcons name="email-outline" size={20} color="#AAAAAA" />
          </View>

          <TouchableOpacity
            style={[styles.sendBtn, loading ? styles.sendBtnDisabled : null]}
            onPress={handleSendCode}
            disabled={loading}
            accessibilityRole="button"
            accessibilityLabel={loading ? 'Enviando código' : 'Enviar código de recuperação'}
            accessibilityState={{ disabled: loading }}
          >
            <Text style={styles.sendBtnText}>{loading ? 'Enviando...' : 'Enviar código'}</Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => router.replace('/login')}
            activeOpacity={0.8}
            accessibilityRole="button"
            accessibilityLabel="Lembrou a senha? Fazer login"
          >
            <Text style={styles.loginBackText}>
              Lembrou a senha? <Text style={styles.loginBackLink}>Fazer login</Text>
            </Text>
          </TouchableOpacity>
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
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
  subtitle: {
    color: '#666666',
    fontSize: 14,
    lineHeight: 22,
    textAlign: 'center',
  },
  title: {
    color: '#1E1D1D',
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginTop: 24,
    fontFamily: 'Agrandir-TextBold',
  },
  illustrationWrap: {
    width: 260,
    height: 200,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  label: {
    color: '#1E1D1D',
    fontSize: 13,
    fontWeight: '600',
    marginBottom: 6,
    alignSelf: 'flex-start',
    width: '100%',
    marginTop: 28,
  },
  inputWrap: {
    backgroundColor: '#F5F5F5',
    borderRadius: 12,
    height: 52,
    paddingHorizontal: 16,
    flexDirection: 'row',
    alignItems: 'center',
    width: '100%',
  },
  input: {
    flex: 1,
    fontSize: 14,
    color: '#1E1D1D',
  },
  sendBtn: {
    backgroundColor: '#0057A8',
    borderRadius: 40,
    height: 52,
    marginTop: 24,
    alignSelf: 'stretch',
    marginHorizontal: -6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnDisabled: {
    opacity: 0.7,
  },
  sendBtnText: {
    color: '#FFFFFF',
    fontWeight: '700',
    fontSize: 15,
  },
  loginBackText: {
    color: '#666666',
    fontSize: 13,
    textAlign: 'center',
    marginTop: 20,
  },
  loginBackLink: {
    color: '#0057A8',
    fontWeight: '600',
  },
});
