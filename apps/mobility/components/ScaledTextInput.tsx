import {
  TextInput as RNTextInput,
  type TextInputProps,
  StyleSheet,
  type TextStyle,
} from 'react-native';
import { forwardRef } from 'react';
import {
  shouldApplyHighContrastTextColor,
  useAccessibilityPreferences,
} from '@/contexts/accessibility-preferences';

/**
 * Drop-in replacement for React Native TextInput with font scaling and high-contrast colors.
 */
export const ScaledTextInput = forwardRef<RNTextInput, TextInputProps>(function ScaledTextInput(
  props,
  ref,
) {
  const { fontScale, highContrast, hydrated, colors } = useAccessibilityPreferences();
  const { style, placeholderTextColor, ...rest } = props;
  const flat = StyleSheet.flatten(style) as TextStyle | undefined;
  const baseFs = flat && typeof flat.fontSize === 'number' ? flat.fontSize : null;
  const scaledFs = baseFs != null ? Math.round(baseFs * fontScale) : null;
  const hcColor =
    highContrast && hydrated && shouldApplyHighContrastTextColor(highContrast, flat?.color as string | undefined)
      ? { color: colors.text }
      : null;
  const ph =
    placeholderTextColor !== undefined
      ? placeholderTextColor
      : highContrast && hydrated
        ? colors.textMuted
        : undefined;

  return (
    <RNTextInput
      ref={ref}
      {...rest}
      placeholderTextColor={ph}
      style={[style, scaledFs != null ? { fontSize: scaledFs } : null, hcColor]}
    />
  );
});
