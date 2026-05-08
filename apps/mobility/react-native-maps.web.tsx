/**
 * Stub para web: react-native-maps usa APIs nativas e não roda no browser.
 * Mantém a app compilável; o mapa real continua em Android/iOS.
 */
import React, { forwardRef, useImperativeHandle, type ReactNode } from 'react';
import { StyleSheet, Text, View, type StyleProp, type ViewStyle } from 'react-native';

export const PROVIDER_GOOGLE = 'google';

export type LatLng = { latitude: number; longitude: number };

export type Region = LatLng & {
  latitudeDelta: number;
  longitudeDelta: number;
};

export type MapViewRef = {
  fitToCoordinates: (coordinates: LatLng[], options?: Record<string, unknown>) => void;
  animateToRegion: (region: Region, duration?: number) => void;
};

type MapViewProps = {
  style?: StyleProp<ViewStyle>;
  children?: ReactNode;
  region?: Region;
  initialRegion?: Region;
  provider?: string;
  showsUserLocation?: boolean;
  showsMyLocationButton?: boolean;
  scrollEnabled?: boolean;
  mapType?: string;
};

const MapView = forwardRef<MapViewRef, MapViewProps>(function MapView(
  { style, children, ..._rest },
  ref,
) {
  useImperativeHandle(ref, () => ({
    fitToCoordinates: () => {},
    animateToRegion: () => {},
  }));

  return (
    <View style={[styles.map, style]}>
      {children}
      <View style={styles.hint} pointerEvents="none">
        <Text style={styles.hintText}>
          Mapa interativo disponível na app (Android ou iOS). No navegador é só pré-visualização.
        </Text>
      </View>
    </View>
  );
});

type MarkerProps = {
  coordinate: LatLng;
  children?: ReactNode;
  title?: string;
  pinColor?: string;
  anchor?: { x: number; y: number };
};

export function Marker({ children, coordinate: _c, title: _t, pinColor: _p, anchor: _a, ...rest }: MarkerProps) {
  if (children != null) {
    return <View {...rest}>{children}</View>;
  }
  return <View style={styles.dot} {...rest} />;
}

type PolylineProps = {
  coordinates: LatLng[];
  strokeColor?: string;
  strokeWidth?: number;
};

export function Polyline(_props: PolylineProps) {
  return null;
}

const styles = StyleSheet.create({
  map: {
    overflow: 'hidden',
    backgroundColor: '#E4ECF4',
    position: 'relative',
    justifyContent: 'center',
    alignItems: 'center',
  },
  hint: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingVertical: 6,
    paddingHorizontal: 10,
    backgroundColor: 'rgba(255,255,255,0.92)',
  },
  hintText: {
    fontSize: 11,
    color: '#555',
    textAlign: 'center',
  },
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#0057A8',
  },
});

export default MapView;
