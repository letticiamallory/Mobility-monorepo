import type { RouteCoordInput } from '../utils/route-endpoint';
import { routeDurationMinutes, routeSignature } from '../utils/route-results-logic';
import { getToken } from './token.service';
import { searchRoutes, SearchRoutesTimeoutError } from './routes.service';

/** Lançado quando toda(s) chamada(s) de rota deram 401/403 — UI deve direcionar para login. */
export class RoutesUnauthorizedError extends Error {
  constructor(message = 'Sessão expirada. Faça login novamente.') {
    super(message);
    this.name = 'RoutesUnauthorizedError';
  }
}

/** Lançado quando todas as chamadas de transporte deram timeout — UI pode sugerir tentar de novo. */
export class RoutesAllTimedOutError extends Error {
  constructor(message = 'O servidor demorou demais. Tente buscar novamente.') {
    super(message);
    this.name = 'RoutesAllTimedOutError';
  }
}

/** Uma única `searchRoutes` usa 15s; aqui rodamos 4 em paralelo + fallback — precisa de folga. */
const DIVERSE_ROUTES_TIMEOUT_MS = 55_000;

const DEFAULT_TRANSPORT_TYPE = 'bus';

/** Forma mínima compatível com o payload de `routes` em route-results. */
export type FetchedRouteItem = {
  stages?: { mode?: string; line_code?: string; stop_name?: string }[];
  total_duration?: string;
  totalDuration?: string;
  totalTime?: string;
  total_distance?: string;
  accessible?: boolean;
  search_profile?: 'alone' | 'companied';
  accessibility_score?: number;
  [key: string]: unknown;
};

export type DiverseRoutesPayload = {
  alone: FetchedRouteItem[];
  companied: FetchedRouteItem[];
};

function dualFromApiBody(body: Record<string, unknown>): DiverseRoutesPayload {
  const ra = body.routes_alone;
  const rc = body.routes_companied;
  if (Array.isArray(ra) || Array.isArray(rc)) {
    return {
      alone: Array.isArray(ra) ? (ra as FetchedRouteItem[]) : [],
      companied: Array.isArray(rc) ? (rc as FetchedRouteItem[]) : [],
    };
  }
  const legacy = Array.isArray(body.routes) ? (body.routes as FetchedRouteItem[]) : [];
  const sp = body.search_profile;
  if (sp === 'alone') return { alone: legacy, companied: [] };
  if (sp === 'companied') return { alone: [], companied: legacy };
  return { alone: legacy, companied: [] };
}

function accessibilitySortKey(route: FetchedRouteItem): number {
  const raw = route.accessibility_score;
  return typeof raw === 'number' && Number.isFinite(raw) ? raw : 0;
}

/** Mantém a ocorrência com maior `accessibility_score` quando a assinatura colide. */
function dedupeBySignature(routes: FetchedRouteItem[]): FetchedRouteItem[] {
  const bySig = new Map<string, FetchedRouteItem>();
  for (const route of routes) {
    const key = routeSignature(route);
    const prev = bySig.get(key);
    if (!prev) {
      bySig.set(key, route);
      continue;
    }
    if (accessibilitySortKey(route) > accessibilitySortKey(prev)) {
      bySig.set(key, route);
    }
  }
  return Array.from(bySig.values());
}

/** Remove da lista acompanhado qualquer trajeto cuja assinatura já está em “sozinho”. */
function makeDisjoint(alone: FetchedRouteItem[], companied: FetchedRouteItem[]): FetchedRouteItem[] {
  const aloneKeys = new Set(alone.map((r) => routeSignature(r)));
  return companied.filter((r) => !aloneKeys.has(routeSignature(r)));
}

/**
 * Agrega várias respostas de transporte (bus / metro / …): deduplica e mantém abas disjuntas.
 * Ordena por duração total ascendente; desempate = maior `accessibility_score`.
 */
export async function fetchDiverseRoutes(
  originQuery: string,
  destinationQuery: string,
  userId: number,
  accompanied?: string,
  timeFilter?: string,
  timeValue?: string,
  routePreference?: string,
  historyExtras?: {
    originTitle?: string;
    destinationTitle?: string;
    originAddress?: string;
    destinationAddress?: string;
    originCoord?: RouteCoordInput;
    destinationCoord?: RouteCoordInput;
    /** `less_transfers` e/ou `less_walking` — combináveis. */
    routePreferences?: string[];
  },
): Promise<DiverseRoutesPayload> {
  const overallController = new AbortController();
  const overallTimer = setTimeout(
    () => overallController.abort(),
    DIVERSE_ROUTES_TIMEOUT_MS,
  );
  const accompaniedToSend = accompanied && accompanied.trim() ? accompanied : undefined;
  /** Uma leitura de token para as 4 requisições paralelas (evita fila em SecureStore). */
  const authToken = await getToken();
  const mergeSettled = (results: PromiseSettledResult<unknown>[]) => {
    const mergedAlone: FetchedRouteItem[] = [];
    const mergedCompanied: FetchedRouteItem[] = [];
    for (const result of results) {
      if (result.status !== 'fulfilled') continue;
      const parsed =
        result.value && typeof result.value === 'object'
          ? (result.value as Record<string, unknown>)
          : {};
      const { alone, companied } = dualFromApiBody(parsed);
      mergedAlone.push(...alone);
      mergedCompanied.push(...companied);
    }
    let aloneOut = dedupeBySignature(mergedAlone);
    let companiedOut = dedupeBySignature(mergedCompanied);
    companiedOut = makeDisjoint(aloneOut, companiedOut);
    const sortByDurationThenAccessibility = (a: FetchedRouteItem, b: FetchedRouteItem) => {
      const durDiff = routeDurationMinutes(a) - routeDurationMinutes(b);
      if (durDiff !== 0) return durDiff;
      return accessibilitySortKey(b) - accessibilitySortKey(a);
    };
    aloneOut.sort(sortByDurationThenAccessibility);
    companiedOut.sort(sortByDurationThenAccessibility);
    return { alone: aloneOut, companied: companiedOut };
  };

  const searchOpts = {
    signal: overallController.signal,
    timeoutMs: DIVERSE_ROUTES_TIMEOUT_MS,
    ...(historyExtras?.originTitle?.trim()
      ? { originTitle: historyExtras.originTitle.trim() }
      : {}),
    ...(historyExtras?.destinationTitle?.trim()
      ? { destinationTitle: historyExtras.destinationTitle.trim() }
      : {}),
    ...(historyExtras?.originAddress?.trim()
      ? { originAddress: historyExtras.originAddress.trim() }
      : {}),
    ...(historyExtras?.destinationAddress?.trim()
      ? { destinationAddress: historyExtras.destinationAddress.trim() }
      : {}),
    ...(historyExtras?.originCoord != null ? { originCoord: historyExtras.originCoord } : {}),
    ...(historyExtras?.destinationCoord != null
      ? { destinationCoord: historyExtras.destinationCoord }
      : {}),
    ...(historyExtras?.routePreferences?.length
      ? { routePreferences: historyExtras.routePreferences }
      : {}),
  };

  const transportTypes = ['bus', 'subway', 'combined', 'walk'] as const;
  try {
    const allResults = await Promise.allSettled(
      transportTypes.map((transportType) =>
        searchRoutes(
          originQuery,
          destinationQuery,
          userId,
          transportType,
          accompaniedToSend,
          timeFilter,
          timeValue,
          routePreference,
          searchOpts,
        ),
      ),
    );

    /**
     * Se TODAS as chamadas falharam, vale a pena erguer um erro tipado em vez de
     * voltar lista vazia silenciosa — assim a tela mostra mensagem útil
     * (ex.: 401 → mandar pro login; timeout → sugerir tentar de novo).
     */
    const fulfilled = allResults.filter((r) => r.status === 'fulfilled');
    if (fulfilled.length === 0) {
      const reasons = allResults
        .filter((r): r is PromiseRejectedResult => r.status === 'rejected')
        .map((r) => r.reason);
      const allUnauthorized =
        reasons.length > 0 &&
        reasons.every((reason) => {
          const status = (reason as { status?: number } | undefined)?.status;
          return status === 401 || status === 403;
        });
      if (allUnauthorized) throw new RoutesUnauthorizedError();
      const allTimedOut =
        reasons.length > 0 && reasons.every((reason) => reason instanceof SearchRoutesTimeoutError);
      if (allTimedOut) throw new RoutesAllTimedOutError();
    }

    let merged = mergeSettled(allResults);

    if (
      merged.alone.length === 0 &&
      merged.companied.length === 0 &&
      !overallController.signal.aborted
    ) {
      const fallbackRaw = await searchRoutes(
        originQuery,
        destinationQuery,
        userId,
        DEFAULT_TRANSPORT_TYPE,
        accompaniedToSend,
        timeFilter,
        timeValue,
        routePreference,
        searchOpts,
      );
      const parsed =
        fallbackRaw && typeof fallbackRaw === 'object'
          ? (fallbackRaw as Record<string, unknown>)
          : {};
      merged = mergeSettled([{ status: 'fulfilled', value: parsed }]);
    }

    return merged;
  } finally {
    clearTimeout(overallTimer);
  }
}
