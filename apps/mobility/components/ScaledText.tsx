import { Text as RNText, type TextProps, StyleSheet, type TextStyle } from 'react-native';
import { forwardRef } from 'react';
import {
  shouldApplyHighContrastTextColor,
  useAccessibilityPreferences,
} from '@/contexts/accessibility-preferences';

/**
 * Drop-in replacement for React Native Text that applies saved font scaling and high-contrast text colors.
 */
export const ScaledText = forwardRef<RNText, TextProps>(function ScaledText(props, ref) {
  const { fontScale, highContrast, hydrated, colors } = useAccessibilityPreferences();
  const { style, ...rest } = props;
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  const baseFs = flat && typeof flat.fontSize === 'number' ? flat.fontSize : null;
  const scaledFs = baseFs != null ? Math.round(baseFs * fontScale) : null;
  const hcColor =
    highContrast && hydrated && shouldApplyHighContrastTextColor(highContrast, flat?.color as string | undefined)
      ? { color: colors.text }
      : null;

  return (
    <RNText
      ref={ref}
      {...rest}
      style={[style, scaledFs != null ? { fontSize: scaledFs } : null, hcColor]}
    />
  );
});
