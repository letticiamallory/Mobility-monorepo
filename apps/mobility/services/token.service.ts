import { Platform } from 'react-native';

const TOKEN_KEY = 'mobility_token';
const USER_ID_KEY = 'mobility_user_id';
const USER_NAME_KEY = 'mobility_user_name';
const USER_EMAIL_KEY = 'mobility_user_email';
const REMEMBER_ME_KEY = 'mobility_remember_me';
const USER_AVATAR_KEY = 'mobility_user_avatar';

const isWeb = Platform.OS === 'web';

/**
 * Avatar pode ser data URI base64 (até centenas de KB), e o SecureStore Android tem
 * limite de ~2 KB por valor. Usar AsyncStorage para o avatar evita perdas silenciosas.
 */
async function asyncGet(key: string): Promise<string | null> {
  if (isWeb) return webGet(key);
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  return AsyncStorage.getItem(key);
}

async function asyncSet(key: string, value: string) {
  if (isWeb) {
    webSet(key, value);
    return;
  }
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  await AsyncStorage.setItem(key, value);
}

async function asyncDelete(key: string) {
  if (isWeb) {
    webRemove(key);
    return;
  }
  const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
  await AsyncStorage.removeItem(key);
}

function webGet(key: string): string | null {
  try {
    if (typeof localStorage !== 'undefined') return localStorage.getItem(key);
  } catch {
    /* ignore */
  }
  return null;
}

function webSet(key: string, value: string) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem(key, value);
  } catch {
    /* ignore */
  }
}

function webRemove(key: string) {
  try {
    if (typeof localStorage !== 'undefined') localStorage.removeItem(key);
  } catch {
    /* ignore */
  }
}

async function secureGet(key: string): Promise<string | null> {
  if (isWeb) return webGet(key);
  const SecureStore = await import('expo-secure-store');
  return SecureStore.getItemAsync(key);
}

async function secureSet(key: string, value: string) {
  if (isWeb) {
    webSet(key, value);
    return;
  }
  const SecureStore = await import('expo-secure-store');
  await SecureStore.setItemAsync(key, value);
}

async function secureDelete(key: string) {
  if (isWeb) {
    webRemove(key);
    return;
  }
  const SecureStore = await import('expo-secure-store');
  await SecureStore.deleteItemAsync(key);
}

export async function saveToken(token: string) {
  await secureSet(TOKEN_KEY, token);
}

/** Token JWT realmente guardado (nunca o placeholder de dev). Usar p.ex. no auto-login da tela de login. */
export async function getStoredTokenOnly() {
  return secureGet(TOKEN_KEY);
}

export async function getToken() {
  return secureGet(TOKEN_KEY);
}

/** Encerra sessão: JWT + identidade local (evita `user_id` antigo com token ausente). */
export async function removeToken() {
  await secureDelete(TOKEN_KEY);
  await secureDelete(USER_ID_KEY);
  await secureDelete(USER_NAME_KEY);
  await secureDelete(USER_EMAIL_KEY);
  // Limpa as duas localizações usadas pelo avatar (legado em SecureStore e novo em AsyncStorage).
  await secureDelete(USER_AVATAR_KEY);
  await asyncDelete(USER_AVATAR_KEY);
}

export async function saveUserInfo(userId: number, name: string, email?: string) {
  await secureSet(USER_ID_KEY, String(userId));
  await secureSet(USER_NAME_KEY, name);
  if (email) {
    await secureSet(USER_EMAIL_KEY, email);
  } else {
    await secureDelete(USER_EMAIL_KEY);
  }
}

export async function getUserInfo() {
  const userId = await secureGet(USER_ID_KEY);
  const name = await secureGet(USER_NAME_KEY);
  const email = await secureGet(USER_EMAIL_KEY);

  if (userId || (name && String(name).trim())) {
    return {
      userId: userId ? Number(userId) : null,
      name,
      email,
    };
  }
  return {
    userId: null,
    name,
    email,
  };
}

export async function saveRememberMe(enabled: boolean) {
  await secureSet(REMEMBER_ME_KEY, enabled ? '1' : '0');
}

export async function getRememberMe() {
  const value = await secureGet(REMEMBER_ME_KEY);
  if (value === null) return true;
  return value === '1';
}

/**
 * Persiste o avatar do usuário em AsyncStorage. Suporta:
 *  - URI local de `expo-image-picker` (`file://...`) — só salva se o caller tiver garantido
 *    que o arquivo continua acessível; em geral preferir `data:image/...;base64,...`.
 *  - data URI em base64.
 *  - URL HTTP/HTTPS (futuro upload pra backend).
 */
export async function saveUserAvatar(avatarUri?: string | null) {
  const trimmed = avatarUri?.trim();
  if (trimmed) {
    await asyncSet(USER_AVATAR_KEY, trimmed);
    // Apaga eventual valor legado no SecureStore para não conflitar.
    await secureDelete(USER_AVATAR_KEY);
    return;
  }
  await asyncDelete(USER_AVATAR_KEY);
  await secureDelete(USER_AVATAR_KEY);
}

export async function getUserAvatar() {
  // Primeiro AsyncStorage (novo padrão); fallback para o valor antigo no SecureStore.
  const fresh = await asyncGet(USER_AVATAR_KEY);
  if (fresh) return fresh;
  return secureGet(USER_AVATAR_KEY);
}

/** Limpa chaves de auth no SecureStore/localStorage e AsyncStorage (favoritos/recents). Só para diagnóstico em dev. */
export async function clearAllMobilityStorage() {
  await secureDelete(TOKEN_KEY);
  await secureDelete(USER_ID_KEY);
  await secureDelete(USER_NAME_KEY);
  await secureDelete(USER_EMAIL_KEY);
  await secureDelete(REMEMBER_ME_KEY);
  await secureDelete(USER_AVATAR_KEY);
  await asyncDelete(USER_AVATAR_KEY);
  if (!isWeb) {
    const AsyncStorage = (await import('@react-native-async-storage/async-storage')).default;
    await AsyncStorage.clear();
  }
}
