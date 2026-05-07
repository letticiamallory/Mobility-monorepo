import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { ScrollView, StatusBar, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { OutOfCoverageIllustration } from '@/components/OutOfCoverageIllustration';
import { ScaledText as Text } from '@/components/ScaledText';
import { useAccessibilitySurfaces } from '@/contexts/accessibility-preferences';
import { A11Y_HIT_SLOP } from '@/constants/accessibility';

const PRIMARY = '#0057A8';
const BG = '#F5F5F5';
const TITLE = '#111827';
const MUTED = '#6B7280';

export default function OutOfCoverageScreen() {
  const router = useRouter();
  const sx = useAccessibilitySurfaces();

  return (
    <SafeAreaView style={[styles.safe, sx.fillScreen]} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />
      <StatusBar barStyle="dark-content" />

      <View style={styles.topBar}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={A11Y_HIT_SLOP}
          style={styles.backBtn}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color={TITLE} />
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={styles.scroll}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.artWrap}>
          <OutOfCoverageIllustration />
        </View>

        <Text style={styles.headline}>Fora da nossa área por enquanto</Text>
        <Text style={styles.sub}>
          Só calculamos trajetos em transporte público para{' '}
          <Text style={styles.em}>Montes Claros</Text>, <Text style={styles.em}>Brasília</Text> e a{' '}
          <Text style={styles.em}>Grande São Paulo</Text>. Escolha origem e destino dentro dessas
          regiões para continuar.
        </Text>

        <Text style={styles.hint}>
          Se você já está em uma dessas cidades, verifique se o mapa apontou o endereço certo.
        </Text>

        <TouchableOpacity
          style={styles.cta}
          onPress={() => router.back()}
          activeOpacity={0.92}
          accessibilityRole="button"
          accessibilityLabel="Voltar para ajustar origem ou destino"
        >
          <Text style={styles.ctaText}>Ajustar origem e destino</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: BG,
  },
  topBar: {
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  backBtn: {
    padding: 8,
    alignSelf: 'flex-start',
  },
  scroll: {
    paddingHorizontal: 24,
    paddingTop: 56,
    paddingBottom: 32,
  },
  headline: {
    fontSize: 22,
    fontFamily: 'Agrandir-TextBold',
    color: TITLE,
    marginBottom: 12,
    lineHeight: 28,
  },
  sub: {
    fontSize: 16,
    fontFamily: 'Agrandir-Regular',
    color: MUTED,
    lineHeight: 24,
    marginBottom: 16,
  },
  em: {
    color: TITLE,
    fontFamily: 'Agrandir-TextBold',
  },
  artWrap: {
    marginBottom: 24,
    alignItems: 'center',
  },
  hint: {
    fontSize: 14,
    fontFamily: 'Agrandir-Regular',
    color: MUTED,
    lineHeight: 21,
    marginBottom: 24,
  },
  cta: {
    backgroundColor: PRIMARY,
    borderRadius: 14,
    paddingVertical: 16,
    alignItems: 'center',
  },
  ctaText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontFamily: 'Agrandir-TextBold',
  },
});
