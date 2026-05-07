import AsyncStorage from '@react-native-async-storage/async-storage';

const STORAGE_KEY = '@mobility/accessibility_ui_prefs';

export type FontSizeTier = 'A' | 'AA' | 'AAA';

export type AccessibilityUiPrefs = {
  voiceRead: boolean;
  highContrast: boolean;
  fontSize: FontSizeTier;
};

export const DEFAULT_ACCESSIBILITY_UI_PREFS: AccessibilityUiPrefs = {
  voiceRead: false,
  highContrast: false,
  fontSize: 'A',
};

export function fontTierToScale(tier: FontSizeTier): number {
  switch (tier) {
    case 'AA':
      return 1.15;
    case 'AAA':
      return 1.3;
    default:
      return 1;
  }
}

export async function loadAccessibilityUiPrefs(): Promise<AccessibilityUiPrefs> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return { ...DEFAULT_ACCESSIBILITY_UI_PREFS };
    const parsed = JSON.parse(raw) as Partial<AccessibilityUiPrefs>;
    const fontSize =
      parsed.fontSize === 'AA' || parsed.fontSize === 'AAA' ? parsed.fontSize : 'A';
    return {
      voiceRead: !!parsed.voiceRead,
      highContrast: !!parsed.highContrast,
      fontSize,
    };
  } catch {
    return { ...DEFAULT_ACCESSIBILITY_UI_PREFS };
  }
}

export async function saveAccessibilityUiPrefs(prefs: AccessibilityUiPrefs): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(prefs));
}
