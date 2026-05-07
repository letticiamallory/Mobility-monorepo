import * as Speech from 'expo-speech';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { ViewStyle } from 'react-native';
import { StatusBar } from 'react-native';
import {
  adaptNavigationTheme,
  MD3DarkTheme,
  MD3LightTheme,
  PaperProvider,
  type MD3Theme,
} from 'react-native-paper';
import {
  DarkTheme,
  DefaultTheme,
  ThemeProvider as NavigationThemeProvider,
  type Theme as NavigationTheme,
} from '@react-navigation/native';
import {
  DEFAULT_ACCESSIBILITY_UI_PREFS,
  fontTierToScale,
  loadAccessibilityUiPrefs,
  saveAccessibilityUiPrefs,
  type AccessibilityUiPrefs,
  type FontSizeTier,
} from '@/services/accessibility-prefs.service';

export type A11yColors = {
  screenBackground: string;
  cardBackground: string;
  text: string;
  textMuted: string;
  border: string;
  primary: string;
  onPrimary: string;
};

const NORMAL_COLORS: A11yColors = {
  screenBackground: '#F5F7FA',
  cardBackground: '#FFFFFF',
  text: '#1E1D1D',
  textMuted: '#6B7280',
  border: '#E5E7EB',
  primary: '#0057A8',
  onPrimary: '#FFFFFF',
};

const HIGH_CONTRAST_COLORS: A11yColors = {
  screenBackground: '#000000',
  cardBackground: '#000000',
  text: '#FFFFFF',
  textMuted: '#EEEEEE',
  border: '#FFFFFF',
  primary: '#FFFF00',
  onPrimary: '#000000',
};

/** Body-like colors we remap in high contrast so text stays readable on dark backgrounds. */
const HC_TEXT_COLOR_KEYS = new Set(
  [
    '#1e1d1d',
    '#374151',
    '#6b7280',
    '#9ca3af',
    '#000000',
    '#1e293b',
    '#4b5563',
    '#111827',
    '#aaaaaa',
    '#cccccc',
  ].map((c) => c.toLowerCase()),
);

function normalizeHexColor(c: string): string {
  return c.replace(/\s/g, '').toLowerCase();
}

export function shouldApplyHighContrastTextColor(
  highContrast: boolean,
  flatColor: string | undefined | null,
): boolean {
  if (!highContrast) return false;
  if (flatColor == null || flatColor === '') return true;
  if (typeof flatColor !== 'string') return false;
  const n = normalizeHexColor(flatColor);
  return HC_TEXT_COLOR_KEYS.has(n);
}

function scaleMd3Fonts(theme: MD3Theme, scale: number): MD3Theme {
  if (scale === 1) return theme;
  const fonts = { ...theme.fonts } as Record<string, { fontSize?: number } & Record<string, unknown>>;
  for (const key of Object.keys(fonts)) {
    const entry = fonts[key];
    if (entry && typeof entry.fontSize === 'number') {
      fonts[key] = { ...entry, fontSize: Math.round(entry.fontSize * scale) };
    }
  }
  return { ...theme, fonts: fonts as MD3Theme['fonts'] };
}

function buildHighContrastMd3(fontScale: number): MD3Theme {
  const base = scaleMd3Fonts(MD3DarkTheme, fontScale);
  return {
    ...base,
    dark: true,
    colors: {
      ...base.colors,
      primary: '#FFFF00',
      onPrimary: '#000000',
      primaryContainer: '#333300',
      onPrimaryContainer: '#FFFF00',
      background: '#000000',
      surface: '#000000',
      surfaceVariant: '#1A1A1A',
      onSurface: '#FFFFFF',
      onSurfaceVariant: '#FFFFFF',
      onBackground: '#FFFFFF',
      outline: '#FFFFFF',
      outlineVariant: '#CCCCCC',
      elevation: {
        ...base.colors.elevation,
        level0: 'transparent',
        level1: '#000000',
        level2: '#000000',
        level3: '#000000',
        level4: '#000000',
        level5: '#000000',
      },
    },
  };
}

function buildLightMd3(fontScale: number): MD3Theme {
  const base = scaleMd3Fonts(MD3LightTheme, fontScale);
  return {
    ...base,
    colors: {
      ...base.colors,
      background: NORMAL_COLORS.screenBackground,
      surface: NORMAL_COLORS.cardBackground,
      onSurface: NORMAL_COLORS.text,
    },
  };
}

type AccessibilityPreferencesContextValue = {
  hydrated: boolean;
  voiceRead: boolean;
  highContrast: boolean;
  fontSize: FontSizeTier;
  fontScale: number;
  colors: A11yColors;
  navigationTheme: NavigationTheme;
  paperTheme: MD3Theme;
  setVoiceRead: (v: boolean) => void;
  setHighContrast: (v: boolean) => void;
  setFontSize: (v: FontSizeTier) => void;
  commitAccessibilityUiPrefs: (prefs: AccessibilityUiPrefs) => Promise<void>;
  speakIfEnabled: (
    message: string,
    options?: { language?: string; voiceReadOverride?: boolean },
  ) => void;
  stopSpeaking: () => void;
};

const defaultValue: AccessibilityPreferencesContextValue = {
  hydrated: false,
  ...DEFAULT_ACCESSIBILITY_UI_PREFS,
  fontScale: 1,
  colors: NORMAL_COLORS,
  navigationTheme: DefaultTheme,
  paperTheme: MD3LightTheme,
  setVoiceRead: () => {},
  setHighContrast: () => {},
  setFontSize: () => {},
  commitAccessibilityUiPrefs: async () => {},
  speakIfEnabled: () => {
    /* default no-op */
  },
  stopSpeaking: () => {},
};

const AccessibilityPreferencesContext = createContext<AccessibilityPreferencesContextValue>(defaultValue);

export function useAccessibilityPreferences() {
  return useContext(AccessibilityPreferencesContext);
}

/** Merged into layouts for high-contrast / saved theme backgrounds (avoid hardcoded #FFF / #F5F7FA). */
export function useAccessibilitySurfaces(): {
  fillScreen: Pick<ViewStyle, 'backgroundColor'>;
  fillCard: Pick<ViewStyle, 'backgroundColor'>;
  hairlineBottom: Pick<ViewStyle, 'borderBottomColor'>;
  hairlineTop: Pick<ViewStyle, 'borderTopColor'>;
  hairlineTopBottom: Pick<ViewStyle, 'borderTopColor' | 'borderBottomColor'>;
  listSeparator: Pick<ViewStyle, 'borderBottomColor'>;
  searchInset: Pick<ViewStyle, 'backgroundColor'>;
  outlineBorder: Pick<ViewStyle, 'borderColor'>;
} {
  const { colors, highContrast } = useAccessibilityPreferences();
  return useMemo(
    () => ({
      fillScreen: { backgroundColor: colors.screenBackground },
      fillCard: { backgroundColor: colors.cardBackground },
      hairlineBottom: { borderBottomColor: highContrast ? colors.border : '#EEEEEE' },
      hairlineTop: { borderTopColor: highContrast ? colors.border : '#EEEEEE' },
      hairlineTopBottom: {
        borderTopColor: highContrast ? colors.border : '#EEEEEE',
        borderBottomColor: highContrast ? colors.border : '#EEEEEE',
      },
      listSeparator: { borderBottomColor: highContrast ? colors.border : '#F5F5F5' },
      searchInset: { backgroundColor: highContrast ? '#1A1A1A' : '#F5F5F5' },
      outlineBorder: { borderColor: colors.border },
    }),
    [colors, highContrast],
  );
}

type ProviderProps = { children: ReactNode };

export function AccessibilityPreferencesProvider({ children }: ProviderProps) {
  const [hydrated, setHydrated] = useState(false);
  const [voiceRead, setVoiceRead] = useState(false);
  const [highContrast, setHighContrast] = useState(false);
  const [fontSize, setFontSize] = useState<FontSizeTier>('A');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const prefs = await loadAccessibilityUiPrefs();
      if (cancelled) return;
      setVoiceRead(prefs.voiceRead);
      setHighContrast(prefs.highContrast);
      setFontSize(prefs.fontSize);
      setHydrated(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const fontScale = useMemo(() => fontTierToScale(fontSize), [fontSize]);

  const colors = useMemo(() => (highContrast ? HIGH_CONTRAST_COLORS : NORMAL_COLORS), [highContrast]);

  const paperTheme = useMemo(() => {
    if (highContrast) return buildHighContrastMd3(fontScale);
    return buildLightMd3(fontScale);
  }, [highContrast, fontScale]);

  const navigationTheme = useMemo((): NavigationTheme => {
    const customLight: NavigationTheme = {
      ...DefaultTheme,
      colors: {
        ...DefaultTheme.colors,
        primary: NORMAL_COLORS.primary,
        background: NORMAL_COLORS.screenBackground,
        card: NORMAL_COLORS.cardBackground,
        text: NORMAL_COLORS.text,
        border: NORMAL_COLORS.border,
        notification: MD3LightTheme.colors.error,
      },
    };
    const customDark: NavigationTheme = {
      ...DarkTheme,
      colors: {
        ...DarkTheme.colors,
        primary: HIGH_CONTRAST_COLORS.primary,
        background: HIGH_CONTRAST_COLORS.screenBackground,
        card: HIGH_CONTRAST_COLORS.cardBackground,
        text: HIGH_CONTRAST_COLORS.text,
        border: HIGH_CONTRAST_COLORS.border,
        notification: HIGH_CONTRAST_COLORS.primary,
      },
    };
    if (highContrast) {
      const { DarkTheme: adapted } = adaptNavigationTheme({
        reactNavigationDark: customDark,
        materialDark: paperTheme,
      });
      return adapted as NavigationTheme;
    }
    const { LightTheme: adapted } = adaptNavigationTheme({
      reactNavigationLight: customLight,
      materialLight: paperTheme,
    });
    return adapted as NavigationTheme;
  }, [highContrast, paperTheme]);

  const commitAccessibilityUiPrefs = useCallback(async (prefs: AccessibilityUiPrefs) => {
    await saveAccessibilityUiPrefs(prefs);
    setVoiceRead(prefs.voiceRead);
    setHighContrast(prefs.highContrast);
    setFontSize(prefs.fontSize);
  }, []);

  const speakIfEnabled = useCallback(
    (message: string, options?: { language?: string; voiceReadOverride?: boolean }) => {
      const useVoice = options?.voiceReadOverride ?? voiceRead;
      if (!useVoice || !message.trim()) return;
      Speech.stop();
      Speech.speak(message.trim(), {
        language: options?.language ?? 'pt-BR',
      });
    },
    [voiceRead],
  );

  const stopSpeaking = useCallback(() => {
    Speech.stop();
  }, []);

  const value = useMemo(
    (): AccessibilityPreferencesContextValue => ({
      hydrated,
      voiceRead,
      highContrast,
      fontSize,
      fontScale,
      colors,
      navigationTheme,
      paperTheme,
      setVoiceRead,
      setHighContrast,
      setFontSize,
      commitAccessibilityUiPrefs,
      speakIfEnabled,
      stopSpeaking,
    }),
    [
      hydrated,
      voiceRead,
      highContrast,
      fontSize,
      fontScale,
      colors,
      navigationTheme,
      paperTheme,
      commitAccessibilityUiPrefs,
      speakIfEnabled,
      stopSpeaking,
    ],
  );

  return (
    <AccessibilityPreferencesContext.Provider value={value}>
      <PaperProvider theme={paperTheme}>
        <NavigationThemeProvider value={navigationTheme}>
          <StatusBar barStyle={highContrast ? 'light-content' : 'dark-content'} />
          {children}
        </NavigationThemeProvider>
      </PaperProvider>
    </AccessibilityPreferencesContext.Provider>
  );
}
