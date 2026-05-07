import {
  ActivityIndicator,
  StyleSheet,
  TouchableOpacity,
  View,
  ViewStyle,
  TextStyle,
} from 'react-native';
import { ScaledText as Text } from '@/components/ScaledText';

type Props = {
  loading: boolean;
  onPress: () => void;
  disabled: boolean;
  style: ViewStyle | ViewStyle[] | (ViewStyle | undefined | null | false)[];
  textStyle: TextStyle;
  idleLabel?: string;
  loadingLabel?: string;
  /** Rótulo para leitores de tela (padrão deriva dos rótulos visíveis). */
  accessibilityLabel?: string;
  /** `spinner`: indicador + texto. `idle-muted`: mantém o rótulo normal com o estilo “desativado” (use com barra de progresso no header). */
  loadingMode?: 'spinner' | 'idle-muted';
  activeOpacity?: number;
};

/**
 * Carregamento: por padrão ActivityIndicator + texto; em `idle-muted` só o rótulo (visual desativado vem do estilo pai).
 */
export function PulsingRouteSearchButton({
  loading,
  onPress,
  disabled,
  style,
  textStyle,
  idleLabel = 'Buscar rotas',
  loadingLabel = 'Buscando rotas',
  loadingMode = 'spinner',
  activeOpacity = 0.85,
  accessibilityLabel: accessibilityLabelProp,
}: Props) {
  const showMutedIdle = loading && loadingMode === 'idle-muted';
  const a11yLabel =
    accessibilityLabelProp ?? (loading && !showMutedIdle ? loadingLabel : idleLabel);

  return (
    <TouchableOpacity
      style={style}
      onPress={onPress}
      disabled={disabled}
      activeOpacity={activeOpacity}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={{ disabled }}
    >
      {loading && !showMutedIdle ? (
        <View style={styles.loadingRow}>
          <ActivityIndicator size="small" color="#FFFFFF" />
          <Text style={textStyle}>{loadingLabel}</Text>
        </View>
      ) : (
        <Text style={textStyle}>{idleLabel}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
});
