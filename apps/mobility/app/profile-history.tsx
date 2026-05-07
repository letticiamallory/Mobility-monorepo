import { MaterialCommunityIcons } from '@expo/vector-icons';
import { Stack, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { FlatList, StyleSheet, TouchableOpacity, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ScaledText as Text } from '@/components/ScaledText';
import { useAccessibilitySurfaces } from '@/contexts/accessibility-preferences';
import { A11Y_HIT_SLOP } from '@/constants/accessibility';
import { API_URL } from '../constants/api';
import { getToken, getUserInfo } from '../services/token.service';

type HistoryItem = {
  id: number;
  origin?: string;
  destination?: string;
  transport_type?: string;
  accessible?: boolean;
  accompanied?: string;
  created_at?: string;
};

export default function ProfileHistoryScreen() {
  const router = useRouter();
  const sx = useAccessibilitySurfaces();
  const [history, setHistory] = useState<HistoryItem[]>([]);
  const [loading, setLoading] = useState(true);

  const loadHistory = async () => {
    try {
      setLoading(true);
      const token = await getToken();
      const { userId } = await getUserInfo();
      if (!token || !userId) {
        router.replace('/login');
        return;
      }
      const response = await fetch(`${API_URL}/routes/history/${userId}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) {
        setHistory([]);
        return;
      }
      const data = (await response.json()) as unknown;
      setHistory(Array.isArray(data) ? (data as HistoryItem[]) : []);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadHistory();
  }, []);

  return (
    <SafeAreaView style={[styles.safeArea, sx.fillScreen]} edges={['top', 'left', 'right']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={[styles.header, sx.fillCard]}>
        <TouchableOpacity
          onPress={() => router.back()}
          hitSlop={A11Y_HIT_SLOP}
          accessibilityRole="button"
          accessibilityLabel="Voltar"
        >
          <MaterialCommunityIcons name="arrow-left" size={24} color="#1E1D1D" />
        </TouchableOpacity>
        <Text style={styles.title}>Histórico de viagens</Text>
        <View style={{ width: 24 }} />
      </View>

      <FlatList
        data={history}
        keyExtractor={(item) => String(item.id)}
        refreshing={loading}
        onRefresh={loadHistory}
        contentContainerStyle={styles.listContent}
        ListEmptyComponent={
          <View style={styles.emptyWrap}>
            <MaterialCommunityIcons name="history" size={38} color="#9CA3AF" />
            <Text style={styles.emptyText}>Nenhuma viagem no histórico ainda.</Text>
          </View>
        }
        renderItem={({ item }) => (
          <View
            style={[styles.card, sx.fillCard]}
            accessible
            accessibilityLabel={`Viagem de ${item.origin || 'origem desconhecida'} para ${item.destination || 'destino desconhecido'}. Transporte ${item.transport_type || 'não informado'}. ${item.accessible ? 'Acessível' : 'Com alerta'}. ${item.created_at ? new Date(item.created_at).toLocaleString('pt-BR') : ''}`}
          >
            <Text style={styles.routeText}>{item.origin || '-'} {'→'} {item.destination || '-'}</Text>
            <View style={styles.metaRow}>
              <Text style={styles.metaText}>Transporte: {item.transport_type || '-'}</Text>
              <Text style={[styles.metaText, item.accessible ? styles.okText : styles.warnText]}>
                {item.accessible ? 'Acessível' : 'Com alerta'}
              </Text>
            </View>
            <Text style={styles.dateText}>
              {item.created_at ? new Date(item.created_at).toLocaleString('pt-BR') : '-'}
            </Text>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: '#F5F5F5' },
  header: {
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { color: '#1E1D1D', fontSize: 18, fontWeight: '700' },
  listContent: { padding: 16, paddingBottom: 28, gap: 10 },
  emptyWrap: { alignItems: 'center', marginTop: 40, gap: 8 },
  emptyText: { color: '#6B7280', fontSize: 14 },
  card: { backgroundColor: '#FFFFFF', borderRadius: 12, padding: 14 },
  routeText: { color: '#0F172A', fontSize: 14, fontWeight: '700' },
  metaRow: { marginTop: 8, flexDirection: 'row', justifyContent: 'space-between' },
  metaText: { color: '#64748B', fontSize: 12 },
  okText: { color: '#16A34A' },
  warnText: { color: '#B45309' },
  dateText: { marginTop: 8, color: '#94A3B8', fontSize: 12 },
});
