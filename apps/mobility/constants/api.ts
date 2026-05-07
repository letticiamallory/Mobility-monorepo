/**
 * URL do mobility-api. Em desenvolvimento costuma ser HTTP na LAN.
 * - Prioridade: EXPO_PUBLIC_API_URL (.env) → host do Metro (Expo) → emulador/simulador.
 * - Celular físico: o debuggerHost costuma ser o IP do PC na mesma Wi‑Fi.
 * - Modo tunnel (exp.direct / u.expo.dev): o app NÃO alcança seu Nest local — defina EXPO_PUBLIC_API_URL com o IP da máquina.
 * - Emulador Android + Metro em 127.0.0.1: usa-se 10.0.2.2 para o host da API.
 * Reinicie o bundler após mudar .env.
 */
import Constants from 'expo-constants';
import { Platform } from 'react-native';

const API_PORT = 3000;

const fromEnv =
  typeof process !== 'undefined' && process.env.EXPO_PUBLIC_API_URL
    ? String(process.env.EXPO_PUBLIC_API_URL).trim().replace(/\/$/, '')
    : '';

function hostFromHostPort(value: string): string | null {
  const s = value.trim().replace(/^https?:\/\//i, '');
  if (!s) return null;
  const colon = s.lastIndexOf(':');
  const host = colon > 0 ? s.slice(0, colon) : s;
  const trimmed = host.trim();
  return trimmed || null;
}

/** Hosts que não podem receber o Nest local na porta da API. */
function isTunnelOrRemotePackagerHost(host: string): boolean {
  const h = host.toLowerCase();
  return (
    h.includes('exp.direct') ||
    h.includes('u.expo.dev') ||
    h.includes('ngrok') ||
    h.includes('ngrok-free.app')
  );
}

function apiBaseFromPackagerHost(host: string): string | null {
  if (!host || isTunnelOrRemotePackagerHost(host)) return null;

  const h = host.toLowerCase();

  // Android emulator: Metro em 127.0.0.1/localhost no PC → API no host via 10.0.2.2
  if (Platform.OS === 'android' && (h === '127.0.0.1' || h === 'localhost')) {
    return `http://10.0.2.2:${API_PORT}`;
  }

  return `http://${host}:${API_PORT}`;
}

/**
 * Preferir debuggerHost (IP que o Expo Go usa para falar com o Metro) antes de hostUri
 * — hostUri pode apontar para tunnel, onde a API local não existe.
 */
function devBaseUrlFromExpo(): string | null {
  const dbg = (Constants.expoGoConfig as { debuggerHost?: string } | null)?.debuggerHost;
  if (dbg && typeof dbg === 'string') {
    const host = hostFromHostPort(dbg);
    if (host) {
      const base = apiBaseFromPackagerHost(host);
      if (base) return base;
    }
  }

  const hostUri = Constants.expoConfig?.hostUri;
  if (hostUri && typeof hostUri === 'string') {
    const host = hostFromHostPort(hostUri);
    if (host) {
      const base = apiBaseFromPackagerHost(host);
      if (base) return base;
    }
  }

  return null;
}

const fallbackByPlatform =
  Platform.OS === 'android'
    ? `http://10.0.2.2:${API_PORT}`
    : `http://127.0.0.1:${API_PORT}`;

export const API_URL = fromEnv || devBaseUrlFromExpo() || fallbackByPlatform;

if (__DEV__) {
  console.log(
    '[constants/api] API_URL =',
    API_URL,
    fromEnv ? '(via EXPO_PUBLIC_API_URL)' : '(via Expo / fallback)',
  );
}
