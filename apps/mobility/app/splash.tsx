import React, { useEffect, useRef } from 'react';
import { Animated, Easing, Image, StyleSheet, View } from 'react-native';
import { Stack, useRouter } from 'expo-router';
import { removeToken } from '../services/token.service';

function devForceLogoutEnabled(): boolean {
  if (!__DEV__) return false;
  const raw = String(process.env.EXPO_PUBLIC_DEV_FORCE_LOGOUT ?? '')
    .trim()
    .toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

export default function SplashScreen() {
  const router = useRouter();

  const mTranslateY = useRef(new Animated.Value(120)).current;
  const mOpacity = useRef(new Animated.Value(0)).current;

  const dot1Scale = useRef(new Animated.Value(0)).current;
  const dot1Opacity = useRef(new Animated.Value(0)).current;

  const dash1Width = useRef(new Animated.Value(0)).current;
  const dash1Opacity = useRef(new Animated.Value(0)).current;

  const dotMidScale = useRef(new Animated.Value(0)).current;
  const dotMidOpacity = useRef(new Animated.Value(0)).current;

  const dash2Width = useRef(new Animated.Value(0)).current;
  const dash2Opacity = useRef(new Animated.Value(0)).current;

  const dot2Scale = useRef(new Animated.Value(0)).current;
  const dot2Opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    let cancelled = false;

    const run = async () => {
      /** Antes da animação: em dev, pode forçar logout para testar cadastro/login de novo. */
      if (devForceLogoutEnabled()) {
        await removeToken();
      }
      if (cancelled) return;

      Animated.sequence([
        // M sobe
        Animated.parallel([
          Animated.timing(mTranslateY, {
            toValue: 0,
            duration: 700,
            delay: 300,
            easing: Easing.out(Easing.back(1.5)),
            useNativeDriver: true,
          }),
          Animated.timing(mOpacity, {
            toValue: 1,
            duration: 500,
            delay: 300,
            useNativeDriver: true,
          }),
        ]),
        // dot 1 aparece
        Animated.parallel([
          Animated.spring(dot1Scale, { toValue: 1, useNativeDriver: true }),
          Animated.timing(dot1Opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        ]),
        // dash 1 cresce
        Animated.parallel([
          Animated.timing(dash1Width, {
            toValue: 36,
            duration: 300,
            easing: Easing.out(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(dash1Opacity, { toValue: 1, duration: 200, useNativeDriver: false }),
        ]),
        // dot meio aparece
        Animated.parallel([
          Animated.spring(dotMidScale, { toValue: 1, useNativeDriver: true }),
          Animated.timing(dotMidOpacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        ]),
        // dash 2 cresce
        Animated.parallel([
          Animated.timing(dash2Width, {
            toValue: 36,
            duration: 300,
            easing: Easing.out(Easing.ease),
            useNativeDriver: false,
          }),
          Animated.timing(dash2Opacity, { toValue: 1, duration: 200, useNativeDriver: false }),
        ]),
        // dot final aparece
        Animated.parallel([
          Animated.spring(dot2Scale, { toValue: 1, useNativeDriver: true }),
          Animated.timing(dot2Opacity, { toValue: 1, duration: 200, useNativeDriver: true }),
        ]),
      ]).start(() => {
        if (cancelled) return;
        setTimeout(() => {
          if (!cancelled) router.replace('/login');
        }, 500);
      });
    };

    void run();
    return () => {
      cancelled = true;
    };
    // Valores animados vêm de useRef — estáveis; só precisamos do router.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router]);

  return (
    <>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.container}>
        <View style={styles.center}>
          {/* M animado */}
          <Animated.View
            style={{ opacity: mOpacity, transform: [{ translateY: mTranslateY }], marginBottom: 12 }}
          >
            <Image
              source={require('../assets/images/mobility_icon (2).png')}
              style={{ width: 140, height: 140 }}
              resizeMode="contain"
            />
          </Animated.View>

          {/* Pontos da rota */}
          <View style={styles.routeRow}>
            {/* Dot 1 */}
            <Animated.View
              style={[
                styles.dot,
                { opacity: dot1Opacity, transform: [{ scale: dot1Scale }] },
              ]}
            />
            {/* Dash 1 */}
            <Animated.View
              style={[styles.dash, { width: dash1Width, opacity: dash1Opacity }]}
            />
            {/* Dot meio */}
            <Animated.View
              style={[
                styles.dotMid,
                { opacity: dotMidOpacity, transform: [{ scale: dotMidScale }] },
              ]}
            />
            {/* Dash 2 */}
            <Animated.View
              style={[styles.dash, { width: dash2Width, opacity: dash2Opacity }]}
            />
            {/* Dot final */}
            <Animated.View
              style={[
                styles.dotEnd,
                { opacity: dot2Opacity, transform: [{ scale: dot2Scale }] },
              ]}
            >
              <View style={styles.dotEndInner} />
            </Animated.View>
          </View>
        </View>
      </View>
    </>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0057A8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  center: {
    alignItems: 'center',
  },
  routeRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  dot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
  },
  dotMid: {
    width: 9,
    height: 9,
    borderRadius: 5,
    backgroundColor: 'rgba(255,255,255,0.5)',
  },
  dotEnd: {
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  dotEndInner: {
    width: 5,
    height: 5,
    borderRadius: 3,
    backgroundColor: '#0057A8',
  },
  dash: {
    height: 2.5,
    backgroundColor: 'rgba(255,255,255,0.6)',
    borderRadius: 2,
    marginHorizontal: 2,
  },
});
