import React from 'react';
import { render } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import RegisterScreen from '../app/register';

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));

jest.mock('expo-image-picker', () => ({
  launchImageLibraryAsync: jest.fn(),
  getMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
  requestMediaLibraryPermissionsAsync: jest.fn().mockResolvedValue({ granted: true }),
}));

jest.mock('../services/auth.service', () => ({
  register: jest.fn(),
}));

jest.mock('@/contexts/accessibility-preferences', () => ({
  useAccessibilityPreferences: () => ({
    fontScale: 1,
    highContrast: false,
    hydrated: true,
    voiceRead: false,
    colors: {
      text: '#1E1D1D',
      screenBackground: '#FFFFFF',
    },
  }),
  useAccessibilitySurfaces: () => ({ fillScreen: {}, fillCard: {} }),
  shouldApplyHighContrastTextColor: jest.fn().mockReturnValue(false),
}));

jest.mock('react-native-safe-area-context', () => {
  const React = require('react');
  const { View: RNView } = require('react-native');
  return {
    SafeAreaProvider: ({ children }: { children?: unknown }) =>
      React.createElement(RNView, null, children),
    SafeAreaView: ({ children, ...rest }: { children?: unknown }) =>
      React.createElement(RNView, rest, children),
    useSafeAreaInsets: () => ({ top: 0, left: 0, right: 0, bottom: 0 }),
  };
});

describe('RegisterScreen (smoke)', () => {
  it('renderiza nome, email e pergunta de grupo (3 personas)', () => {
    const { getByPlaceholderText, getByText } = render(
      <SafeAreaProvider>
        <RegisterScreen />
      </SafeAreaProvider>,
    );
    expect(getByPlaceholderText('Seu nome')).toBeTruthy();
    expect(getByPlaceholderText('seu@email.com')).toBeTruthy();
    expect(getByText(/que grupo voce pertence/i)).toBeTruthy();
  });
});
