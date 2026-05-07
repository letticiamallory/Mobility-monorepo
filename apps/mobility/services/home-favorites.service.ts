import AsyncStorage from '@react-native-async-storage/async-storage';
import { HOME_FAVORITE_SHORTCUTS } from '../mocks/home';

const STORAGE_KEY = 'mobility_home_favorites_v1';

/** Mesmo fallback que search-destination (Brasília). */
export const HOME_FAVORITES_MAP_CENTER = { latitude: -16.7167, longitude: -43.8647 };

export type HomeFavoriteRow = {
  id: string;
  label: string;
  subtitle?: string;
  icon: string;
  address: string;
  lat: number;
  lng: number;
  isPreset: boolean;
};

export const PRESET_FAVORITE_IDS = new Set(HOME_FAVORITE_SHORTCUTS.map((x) => x.id));

export function defaultHomeFavorites(): HomeFavoriteRow[] {
  return HOME_FAVORITE_SHORTCUTS.map((x) => ({
    id: x.id,
    label: x.label,
    subtitle: x.subtitle,
    icon: x.icon,
    address: x.destination,
    lat: HOME_FAVORITES_MAP_CENTER.latitude,
    lng: HOME_FAVORITES_MAP_CENTER.longitude,
    isPreset: true,
  }));
}

export async function getHomeFavorites(): Promise<HomeFavoriteRow[]> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    // Só na primeira abertura (chave inexistente) usamos os 4 atalhos iniciais.
    if (raw === null) return defaultHomeFavorites();
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return defaultHomeFavorites();
    // Lista vazia guardada de propósito — não voltar aos defaults.
    return parsed as HomeFavoriteRow[];
  } catch {
    return defaultHomeFavorites();
  }
}

export async function saveHomeFavorites(list: HomeFavoriteRow[]): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(list));
}

export async function upsertHomeFavorite(row: HomeFavoriteRow): Promise<void> {
  const list = await getHomeFavorites();
  const rid = normId(row.id);
  const i = list.findIndex((x) => normId(x.id) === rid);
  if (i >= 0) list[i] = row;
  else list.push(row);
  await saveHomeFavorites(list);
}

function normId(v: unknown): string {
  return String(v ?? '').trim();
}

/** Remove qualquer favorito (incl. Casa, Trabalho, etc.). Devolve a lista já gravada. */
export async function removeHomeFavorite(id: string): Promise<HomeFavoriteRow[]> {
  const sid = normId(id);
  if (!sid) return getHomeFavorites();
  const list = await getHomeFavorites();
  const next = list.filter((x) => normId(x.id) !== sid);
  await saveHomeFavorites(next);
  return next;
}

/** @deprecated use removeHomeFavorite */
export const removeOrResetHomeFavorite = removeHomeFavorite;

export function generateCustomFavoriteId(): string {
  return `fav_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}
