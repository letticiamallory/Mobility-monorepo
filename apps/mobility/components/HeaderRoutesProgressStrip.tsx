import { useEffect, useRef, useState } from 'react';
import { Animated, Easing, LayoutChangeEvent, StyleSheet, View } from 'react-native';

/**
 * Faixa fina na base do header: segmento azul percorre da esquerda à direita (carregamento indeterminado).
 */
export function HeaderRoutesProgressStrip() {
  const [trackW, setTrackW] = useState(0);
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (trackW <= 0) return;
    anim.setValue(0);
    const loop = Animated.loop(
      Animated.timing(anim, {
        toValue: 1,
        duration: 1250,
        easing: Easing.linear,
        useNativeDriver: true,
      }),
    );
    loop.start();
    return () => {
      loop.stop();
    };
  }, [trackW, anim]);

  const barW = trackW > 0 ? Math.max(20, trackW * 0.34) : 0;

  return (
    <View
      style={styles.track}
      onLayout={(e: LayoutChangeEvent) => {
        const w = e.nativeEvent.layout.width;
        if (w > 0) setTrackW(w);
      }}
    >
      {trackW > 0 ? (
        <Animated.View
          style={[
            styles.bar,
            {
              width: barW,
              transform: [
                {
                  translateX: anim.interpolate({
                    inputRange: [0, 1],
                    outputRange: [-barW, trackW + barW * 0.15],
                  }),
                },
              ],
            },
          ]}
        />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  track: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: 3,
    backgroundColor: '#E8EDF2',
    overflow: 'hidden',
    zIndex: 2,
  },
  bar: {
    position: 'absolute',
    left: 0,
    top: 0,
    height: 3,
    backgroundColor: '#0057A8',
    borderRadius: 2,
  },
});
