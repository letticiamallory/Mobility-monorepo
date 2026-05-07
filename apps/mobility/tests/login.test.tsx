import React from 'react';
import { Alert } from 'react-native';
import { render, fireEvent, waitFor } from '@testing-library/react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LoginScreenInner } from '../app/login';

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

jest.mock('../constants/api', () => ({
  API_URL: 'http://127.0.0.1:3000',
}));

jest.mock('expo-router', () => ({
  useRouter: () => ({ replace: jest.fn(), push: jest.fn() }),
}));

jest.mock('../services/auth.service', () => ({
  login: jest.fn(),
}));

jest.mock('../services/token.service', () => ({
  getRememberMe: jest.fn().mockResolvedValue(false),
  getToken: jest.fn().mockResolvedValue(null),
  getStoredTokenOnly: jest.fn().mockResolvedValue(null),
  saveRememberMe: jest.fn(),
  saveToken: jest.fn(),
  saveUserInfo: jest.fn(),
}));

jest.mock('@/contexts/accessibility-preferences', () => ({
  useAccessibilityPreferences: () => ({
    highContrast: false,
    colors: { screenBackground: '#EEF2FF' },
    voiceRead: false,
  }),
  useAccessibilitySurfaces: () => ({ fillCard: {}, fillScreen: {} }),
}));

jest.mock('../services/google-auth.service', () => ({
  isGoogleLoginEnabled: jest.fn().mockReturnValue(false),
}));

jest.mock('@/components/GoogleLoginSection', () => {
  const React = require('react');
  return {
    GoogleLoginSection: () => null,
    GoogleAuthErrorBoundary: ({ children }: { children?: React.ReactNode }) => children,
  };
});

function renderLogin() {
  return render(
    <SafeAreaProvider>
      <LoginScreenInner />
    </SafeAreaProvider>,
  );
}

describe('LoginScreen', () => {
  beforeEach(() => {
    jest.spyOn(Alert, 'alert').mockImplementation(() => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('deve renderizar campos de email e senha', () => {
    const { getByTestId, getByPlaceholderText } = renderLogin();
    expect(getByTestId('input-email')).toBeTruthy();
    expect(getByTestId('input-senha')).toBeTruthy();
    expect(getByPlaceholderText('Insira seu email')).toBeTruthy();
    expect(getByPlaceholderText('Insira sua senha')).toBeTruthy();
  });

  it('deve alertar quando email e senha estão vazios', async () => {
    const { getByText } = renderLogin();
    fireEvent.press(getByText('Entrar'));
    await waitFor(() => {
      expect(Alert.alert).toHaveBeenCalledWith(
        'Atenção',
        'Preencha o email e a senha',
      );
    });
  });

  it('deve ter link para cadastro', () => {
    const { getByText } = renderLogin();
    expect(getByText(/Registre-se/i)).toBeTruthy();
  });
});
