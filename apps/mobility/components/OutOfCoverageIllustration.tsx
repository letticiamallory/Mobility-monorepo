import { StyleSheet, useWindowDimensions, View } from 'react-native';
import LocationSearchIllustration from '@/assets/images/undraw_location-search_nesh.svg';

const VB_W = 982.48732;
const VB_H = 763.01413;

export function OutOfCoverageIllustration() {
  const { width } = useWindowDimensions();
  const displayW = Math.min(width - 48, 360);
  const displayH = (displayW * VB_H) / VB_W;

  return (
    <View
      style={[styles.wrap, { width: displayW, height: displayH }]}
      accessibilityRole="image"
      accessibilityLabel="Ilustração: pessoa olhando um mapa em busca de um local"
    >
      <LocationSearchIllustration width={displayW} height={displayH} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignSelf: 'center',
  },
});
