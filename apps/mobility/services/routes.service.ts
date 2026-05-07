import { API_URL } from '../constants/api';
import {
  resolveRouteEndpointForApi,
  toLatLngPair,
  type RouteCoordInput,
} from '@/utils/route-endpoint';
import { getToken } from './token.service';

/** Linha retornada por GET /routes/history/:userId */
export type RouteHistoryApiRow = {
  id: number;
  origin?: string;
  destination?: string;
  /** Rótulo curto para listas (API pode devolver camelCase ou snake_case). */
  originTitle?: string | null;
  destinationTitle?: string | null;
  origin_title?: string | null;
  destination_title?: string | null;
  originAddress?: string | null;
  destinationAddress?: string | null;
  origin_address?: string | null;
  destination_address?: string | null;
  transport_type?: string;
  accessible?: boolean;
  created_at?: string;
};

export async function fetchUserRouteHistory(
  token: string,
  userId: number,
): Promise<RouteHistoryApiRow[]> {
  const response = await fetch(`${API_URL}/routes/history/${userId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return [];
  const data = (await response.json()) as unknown;
  return Array.isArray(data) ? (data as RouteHistoryApiRow[]) : [];
}

/** Mais recentes primeiro (por data; desempate por id). */
export function sortRouteHistoryNewestFirst(rows: RouteHistoryApiRow[]): RouteHistoryApiRow[] {
  return [...rows].sort((a, b) => {
    const ta = a.created_at ? new Date(a.created_at).getTime() : 0;
    const tb = b.created_at ? new Date(b.created_at).getTime() : 0;
    if (tb !== ta) return tb - ta;
    return (b.id ?? 0) - (a.id ?? 0);
  });
}

/** Hard cap end-to-end (cliente) — produto exige resposta em ≤ 15 s. */
export const ROUTES_FETCH_TIMEOUT_MS = 15_000;

export type SearchRoutesOptions = {
  signal?: AbortSignal;
  /** Override do timeout local; padrão = ROUTES_FETCH_TIMEOUT_MS. */
  timeoutMs?: number;
  /** Rótulo curto (ex.: main_text) guardado no histórico; endereço completo vai em `origin` / `destination`. */
  originTitle?: string;
  destinationTitle?: string;
  /** Endereço completo persistido em `origin_address` / `destination_address` no histórico. */
  originAddress?: string;
  destinationAddress?: string;
  /** Quando `origin`/`destination` é placeholder (ex.: "Local atual"), enviar coordenadas para a API. */
  originCoord?: RouteCoordInput;
  destinationCoord?: RouteCoordInput;
  /** Preferências combináveis enviadas como `route_preferences` na API. */
  routePreferences?: string[];
  /**
   * Token já lido (ex.: uma vez antes de várias chamadas em paralelo).
   * Se omitido, `getToken()` roda dentro desta função.
   */
  authToken?: string | null;
};

export class SearchRoutesTimeoutError extends Error {
  constructor(timeoutMs = ROUTES_FETCH_TIMEOUT_MS) {
    super(
      `Tempo limite de ${Math.round(timeoutMs / 1000)}s excedido ao buscar rotas`,
    );
    this.name = 'SearchRoutesTimeoutError';
  }
}

export async function searchRoutes(
  origin: string,
  destination: string,
  userId: number,
  transportType: string,
  accompanied?: string,
  timeFilter?: string,
  timeValue?: string,
  routePreference?: string,
  options?: SearchRoutesOptions,
) {
  const token =
    options && 'authToken' in options && options.authToken !== undefined
      ? options.authToken
      : await getToken();
  const url = `${API_URL}/routes/check`;
  const originForApi = resolveRouteEndpointForApi(origin, options?.originCoord);
  const destinationForApi = resolveRouteEndpointForApi(destination, options?.destinationCoord);
  const originPair = toLatLngPair(options?.originCoord);
  const destPair = toLatLngPair(options?.destinationCoord);
  const body = {
    origin: originForApi,
    destination: destinationForApi,
    user_id: userId,
    transport_type: transportType,
    ...(accompanied !== undefined && accompanied !== '' ? { accompanied } : {}),
    ...(timeFilter ? { time_filter: timeFilter } : {}),
    ...(timeValue ? { time_value: timeValue } : {}),
    ...(options?.routePreferences?.length
      ? { route_preferences: options.routePreferences }
      : routePreference
        ? { route_preference: routePreference }
        : {}),
    ...(options?.originTitle?.trim() ? { origin_title: options.originTitle.trim() } : {}),
    ...(options?.destinationTitle?.trim()
      ? { destination_title: options.destinationTitle.trim() }
      : {}),
    ...(options?.originAddress?.trim() ? { origin_address: options.originAddress.trim() } : {}),
    ...(options?.destinationAddress?.trim()
      ? { destination_address: options.destinationAddress.trim() }
      : {}),
    ...(originPair
      ? { origin_latitude: originPair.latitude, origin_longitude: originPair.longitude }
      : {}),
    ...(destPair
      ? {
          destination_latitude: destPair.latitude,
          destination_longitude: destPair.longitude,
        }
      : {}),
  };
  const bodyString = JSON.stringify(body);

  const localController = new AbortController();
  const timeoutMs = options?.timeoutMs ?? ROUTES_FETCH_TIMEOUT_MS;
  const timer = setTimeout(() => localController.abort(), timeoutMs);

  const externalSignal = options?.signal;
  const onExternalAbort = () => localController.abort();
  if (externalSignal) {
    if (externalSignal.aborted) localController.abort();
    else externalSignal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token ?? ''}`,
      },
      body: bodyString,
      signal: localController.signal,
    });

    const httpStatus = response.status;
    const text = await response.text();
    let result: unknown = null;
    try {
      result = text ? JSON.parse(text) : null;
    } catch {
      result = null;
    }

    if (!response.ok) {
      let msg = 'Erro ao buscar rotas';
      if (result && typeof result === 'object' && result !== null && 'message' in result) {
        const m = (result as { message: unknown }).message;
        if (m != null) {
          msg = Array.isArray(m) ? m.map(String).join(', ') : String(m);
        }
      }
      throw Object.assign(new Error(msg), { status: httpStatus });
    }

    return result;
  } catch (error) {
    if ((error as { name?: string })?.name === 'AbortError') {
      throw new SearchRoutesTimeoutError(timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    if (externalSignal) externalSignal.removeEventListener('abort', onExternalAbort);
  }
}
