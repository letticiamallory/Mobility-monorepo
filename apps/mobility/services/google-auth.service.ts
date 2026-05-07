import Constants from 'expo-constants';

/**
 * Google na tela de login vem ligado por padrão.
 * Para ocultar (ex.: build mínimo, testes): defina EXPO_PUBLIC_ENABLE_GOOGLE_LOGIN como
 * `0`, `false`, `off` ou `no`.
 */
export function isGoogleLoginEnabled(): boolean {
  const raw =
    typeof process !== 'undefined' && process.env.EXPO_PUBLIC_ENABLE_GOOGLE_LOGIN != null
      ? String(process.env.EXPO_PUBLIC_ENABLE_GOOGLE_LOGIN).trim().toLowerCase()
      : '';
  if (raw === '0' || raw === 'false' || raw === 'off' || raw === 'no') return false;
  return true;
}

export const GOOGLE_WEB_CLIENT_ID =
  (typeof process !== 'undefined' && process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID
    ? String(process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID).trim()
    : '') || '966467228266-epseipntuog1msdt2eei16944d5uj33h.apps.googleusercontent.com';

export type GoogleAuthPayload = {
  email: string;
  name: string;
  googleId: string;
  token: string;
};

/** `true` quando o app roda dentro do cliente Expo Go (sem módulos nativos custom). */
export function isExpoGo(): boolean {
  return Constants.appOwnership === 'expo';
}

let nativeConfigured = false;

function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length < 2) throw new Error('Token inválido');
  let base64 = parts[1].replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (base64.length % 4)) % 4;
  base64 += '='.repeat(pad);
  const binary = atob(base64);
  const json = decodeURIComponent(
    [...binary].map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
  );
  return JSON.parse(json) as Record<string, unknown>;
}

/** Extrai email / nome / sub a partir do `id_token` retornado pelo OAuth (Expo Go). */
export function googlePayloadFromIdToken(idToken: string): GoogleAuthPayload {
  const data = decodeJwtPayload(idToken);
  const sub = typeof data.sub === 'string' ? data.sub : '';
  const email = typeof data.email === 'string' ? data.email : '';
  const name =
    typeof data.name === 'string'
      ? data.name
      : email
        ? email.split('@')[0] ?? 'Usuário'
        : 'Usuário';
  if (!sub || !email) throw new Error('Resposta Google incompleta');
  return { email, name, googleId: sub, token: idToken };
}

/**
 * Login com Google via módulo nativo (development / store build).
 * Não importe `@react-native-google-signin/google-signin` no topo do arquivo — isso quebra o Expo Go.
 */
export async function signInWithGoogleNative(): Promise<GoogleAuthPayload> {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { GoogleSignin, statusCodes } = require('@react-native-google-signin/google-signin') as typeof import('@react-native-google-signin/google-signin');

  if (!nativeConfigured) {
    GoogleSignin.configure({
      webClientId: GOOGLE_WEB_CLIENT_ID,
      offlineAccess: true,
    });
    nativeConfigured = true;
  }

  try {
    await GoogleSignin.hasPlayServices();
    const userInfo = await GoogleSignin.signIn();
    return {
      email: userInfo.data?.user.email ?? '',
      name: userInfo.data?.user.name ?? '',
      googleId: userInfo.data?.user.id ?? '',
      token: userInfo.data?.idToken ?? '',
    };
  } catch (error: any) {
    if (error.code === statusCodes.SIGN_IN_CANCELLED) throw new Error('Login cancelado');
    if (error.code === statusCodes.IN_PROGRESS) throw new Error('Login em andamento');
    if (error.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE)
      throw new Error('Google Play Services indisponível');
    /**
     * DEVELOPER_ERROR (cód. 10) costuma ser SHA-1 não cadastrado no Google Cloud,
     * package name diferente ou Web Client ID errado. Repassar a mensagem ajuda no diagnóstico.
     */
    const detail = typeof error?.message === 'string' && error.message ? ` (${error.message})` : '';
    throw new Error(`Erro ao fazer login com Google${detail}`);
  }
}
