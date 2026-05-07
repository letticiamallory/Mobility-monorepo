import {
  Injectable,
  NotFoundException,
  BadRequestException,
  Logger,
  InternalServerErrorException,
  HttpException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { QueryFailedError, Repository } from 'typeorm';
import { Routes } from './routes.entity';
import { GeminiService } from './gemini.service';
import {
  GoogleRoutesService,
  RouteOption,
  RouteStage,
} from './google-routes.service';
import { DisabilityType, User } from '../users/users.entity';
import { ElevationService } from '../elevation/elevation.service';
import { WeatherService } from '../weather/weather.service';
import { OverpassService } from '../accessibility/overpass.service';
import { WheelmapService } from '../accessibility/wheelmap.service';
import { FoursquareService } from '../foursquare/foursquare.service';
import { UberService } from '../uber/uber.service';
import { HereService } from '../here/here.service';
import { NotificationsService } from '../notifications/notifications.service';
import { NominatimService } from './nominatim.service';
import { OtpService } from './otp.service';
import {
  isWalkStageMode,
  walkSegmentCoordsOk,
} from './utils/stage-normalization.util';
import { parseWalkDistanceToMeters } from './utils/walk-distance-parse.util';
import {
  RouteCheckTelemetry,
  makeRouteCheckRequestId,
} from './telemetry/route-check-telemetry';
import { WalkAccessibilityEngineService } from './walk-accessibility-engine.service';
import { RouteAccessibilityFusionService } from './route-accessibility-fusion.service';
import { AccessibilityLlmAgentService } from './accessibility-llm-agent.service';
import type {
  AccessibilityAgentOutput,
  AgentPersona,
  AgentRouteVerdict,
} from './contracts/accessibility-llm-agent.contract';
import type {
  LegFusionResult,
  WalkLegSignals,
} from './contracts/route-accessibility-fusion.contract';
import type {
  LegAccessibilityBlocker,
  LegAccessibilityReport,
} from './contracts/route-accessibility.contract';
import {
  computeAccessibilityScore as computeRouteScore,
  partitionRoutesByScore,
  ROUTES_ALONE_MAX,
  ROUTES_ALONE_MIN_SCORE,
  ROUTES_COMPANIED_MAX,
} from './utils/route-scoring.util';
import { makeDeadline, type Deadline } from './utils/deadline.util';

@Injectable()
export class RoutesService {
  private readonly logger = new Logger(RoutesService.name);
  private hasAccompaniedColumn: boolean | null = null;
  /**
   * Trechos walk com análise Gemini por imagem.
   * Opcional: `ROUTES_MAX_WALK_GEMINI_STAGES` (0–15), padrão **5** (comportamento original).
   */
  private static readonly MAX_WALKING_STAGES_TO_ANALYZE = (() => {
    const n = Number(process.env.ROUTES_MAX_WALK_GEMINI_STAGES ?? '5');
    if (!Number.isFinite(n) || n < 0) return 5;
    return Math.min(Math.floor(n), 15);
  })();
  /**
   * Limite em linha reta (Haversine) entre origem e destino geocodificados.
   *
   * TEMP (dev): desativado por padrão, porque o app ainda pode testar rotas
   * entre cidades (ex.: Montes Claros → Brasília). Quando for pra produção,
   * reative com `ROUTES_ENFORCE_MAX_AIR_DISTANCE=1` e ajuste o limite se necessário.
   */
  private static readonly MAX_ROUTE_AIR_DISTANCE_M = 150_000;

  constructor(
    @InjectRepository(Routes)
    private routesRepository: Repository<Routes>,
    @InjectRepository(User)
    private usersRepository: Repository<User>,
    private geminiService: GeminiService,
    private googleRoutesService: GoogleRoutesService,
    private elevationService: ElevationService,
    private weatherService: WeatherService,
    private overpassService: OverpassService,
    private wheelmapService: WheelmapService,
    private foursquareService: FoursquareService,
    private uberService: UberService,
    private hereService: HereService,
    private notificationsService: NotificationsService,
    private nominatimService: NominatimService,
    private otpService: OtpService,
    private walkAccessibilityEngine: WalkAccessibilityEngineService,
    private fusionService: RouteAccessibilityFusionService,
    private accessibilityAgent: AccessibilityLlmAgentService,
  ) {}

  /**
   * Mapeia `disability_type` do usuário para persona usada pelo agente LLM.
   * Default conservador: `reduced_mobility` (a mais genérica) quando não houver
   * tipo definido — evita score otimista demais.
   */
  private resolveAgentPersona(user: User): AgentPersona {
    switch (user.disability_type) {
      case DisabilityType.VISUAL:
        return 'low_vision';
      case DisabilityType.WHEELCHAIR:
        return 'wheelchair';
      case DisabilityType.REDUCED_MOBILITY:
        return 'reduced_mobility';
      default:
        return 'reduced_mobility';
    }
  }

  private parseMinutes(value: unknown): number {
    if (typeof value !== 'string' && typeof value !== 'number') return 0;
    const text = String(value).trim().toLowerCase();
    if (!text) return 0;
    const hours = text.match(/(\d+)\s*h/);
    const minutes = text.match(/(\d+)\s*min/);
    const asHours = hours ? Number(hours[1]) * 60 : 0;
    const asMinutes = minutes ? Number(minutes[1]) : 0;
    const parsed = asHours + asMinutes;
    if (parsed > 0) return parsed;
    const fallback = Number.parseInt(text, 10);
    return Number.isFinite(fallback) ? fallback : 0;
  }

  private saoPauloTodayEpochAt(hour: number, minute: number): number {
    const tz = 'America/Sao_Paulo';
    const formatter = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    });
    const parts = formatter.formatToParts(new Date());
    const y = Number(parts.find((p) => p.type === 'year')?.value);
    const mo = Number(parts.find((p) => p.type === 'month')?.value);
    const d = Number(parts.find((p) => p.type === 'day')?.value);
    const isoLocal = `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00`;
    return Math.floor(new Date(`${isoLocal}-03:00`).getTime() / 1000);
  }

  private saoPauloClockToEpochToday(clock: string): number | null {
    const m = clock.trim().match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = Number(m[1]);
    const mm = Number(m[2]);
    if (!Number.isFinite(h) || !Number.isFinite(mm) || h < 0 || h > 23 || mm < 0 || mm > 59) {
      return null;
    }
    return this.saoPauloTodayEpochAt(h, mm);
  }

  private firstTransitDepartureEpoch(route: RouteOption): number | null {
    const stages = route.stages ?? [];
    const firstTransit = stages.find((s) => {
      const mode = `${s.mode ?? ''}`.toLowerCase();
      return mode === 'bus' || mode === 'subway' || mode === 'rail';
    });
    if (!firstTransit) return null;
    const unix = (firstTransit as unknown as { transit_departure_unix?: unknown })
      .transit_departure_unix;
    if (typeof unix === 'number' && Number.isFinite(unix) && unix > 0) return Math.floor(unix);
    const hhmm = `${(firstTransit as unknown as { departure_time?: unknown }).departure_time ?? ''}`.trim();
    if (!hhmm) return null;
    const nowEpoch = Math.floor(Date.now() / 1000);
    const parsed = this.saoPauloClockToEpochToday(hhmm);
    if (parsed == null) return null;
    // Se a hora já passou hoje, assume que é do "próximo dia" (evita negativo).
    return parsed < nowEpoch ? parsed + 24 * 60 * 60 : parsed;
  }

  private applyTimeFilter(routes: RouteOption[], timeFilter?: string): RouteOption[] {
    const normalized = `${timeFilter ?? ''}`.trim().toLowerCase();
    if (!normalized || normalized === 'set_departure_time' || normalized === 'set_arrival_time') {
      return routes;
    }

    // Produto:
    // - leave_now: próximos ônibus/metrô dentro de 30 min a partir da busca
    // - last_departures_today: a partir das 21:00 (SP)
    const nowEpoch = Math.floor(Date.now() / 1000);
    const windowStart = nowEpoch;
    const windowEnd =
      normalized === 'leave_now' ? nowEpoch + 30 * 60 : Number.POSITIVE_INFINITY;
    const minDeparture =
      normalized === 'last_departures_today'
        ? Math.max(nowEpoch, this.saoPauloTodayEpochAt(21, 0))
        : windowStart;

    const filtered = routes.filter((r) => {
      const dep = this.firstTransitDepartureEpoch(r);
      if (dep == null) return false;
      if (dep < minDeparture) return false;
      if (dep > windowEnd) return false;
      return true;
    });

    // Se não sobrar nada (ex.: rotas sem `departure_time`), não "mata" a busca.
    return filtered.length > 0 ? filtered : routes;
  }

  private walkingMinutes(route: RouteOption): number {
    return (route.stages ?? [])
      .filter((stage) => isWalkStageMode(stage.mode))
      .reduce((acc, stage) => acc + this.parseMinutes(stage.duration), 0);
  }

  private transferCount(route: RouteOption): number {
    const transitStages = (route.stages ?? []).filter((stage) => {
      const mode = `${stage.mode ?? ''}`.toLowerCase();
      return mode === 'bus' || mode === 'subway' || mode === 'rail';
    });
    return Math.max(0, transitStages.length - 1);
  }

  private hasAnyTransitStage(route: RouteOption): boolean {
    return (route.stages ?? []).some((stage) => {
      const mode = `${stage.mode ?? ''}`.toLowerCase();
      return mode === 'bus' || mode === 'subway' || mode === 'rail';
    });
  }

  private walkStageCount(route: RouteOption): number {
    return (route.stages ?? []).filter((stage) => isWalkStageMode(stage.mode)).length;
  }

  private normalizeRoutePreferences(
    route_preferences?: string[],
    route_preference?: string,
  ): { lessTransfers: boolean; lessWalking: boolean } {
    const set = new Set<string>();
    if (Array.isArray(route_preferences)) {
      for (const raw of route_preferences) {
        const n = `${raw ?? ''}`.trim().toLowerCase();
        if (n === 'less_transfers' || n === 'less_walking') set.add(n);
      }
    }
    if (set.size === 0) {
      const legacy = `${route_preference ?? ''}`.trim().toLowerCase();
      if (legacy === 'less_transfers') set.add('less_transfers');
      if (legacy === 'less_walking') set.add('less_walking');
    }
    return {
      lessTransfers: set.has('less_transfers'),
      lessWalking: set.has('less_walking'),
    };
  }

  /** Preferências combináveis: menos trocas e/ou caminhar menos. */
  private applyRoutePreferences(
    routes: RouteOption[],
    prefs: { lessTransfers: boolean; lessWalking: boolean },
  ): RouteOption[] {
    if (!prefs.lessTransfers && !prefs.lessWalking) return routes;

    let working = routes;
    if (prefs.lessTransfers) {
      const transitOnly = working.filter((r) => this.hasAnyTransitStage(r));
      if (transitOnly.length > 0) working = transitOnly;
    }

    return [...working].sort((a, b) => {
      if (prefs.lessTransfers) {
        const d = this.transferCount(a) - this.transferCount(b);
        if (d !== 0) return d;
      }
      if (prefs.lessWalking) {
        const d = this.walkStageCount(a) - this.walkStageCount(b);
        if (d !== 0) return d;
        const d2 = this.walkingMinutes(a) - this.walkingMinutes(b);
        if (d2 !== 0) return d2;
      } else if (prefs.lessTransfers) {
        const d = this.walkingMinutes(a) - this.walkingMinutes(b);
        if (d !== 0) return d;
      }
      if (prefs.lessWalking) {
        return this.transferCount(a) - this.transferCount(b);
      }
      return 0;
    });
  }

  /**
   * OTP `wheelchair=true` usa o modo acessível do roteador (quando o servidor OTP está configurado).
   * `OTP_WHEELCHAIR_ROUTING`: auto (padrão) | always | never | alone | legacy
   */
  private otpWheelchairRouting(user: User, accompanied?: string): boolean {
    const mode = `${process.env.OTP_WHEELCHAIR_ROUTING ?? 'auto'}`
      .trim()
      .toLowerCase();
    if (['always', '1', 'true', 'yes'].includes(mode)) return true;
    if (['never', '0', 'false', 'no'].includes(mode)) return false;
    if (mode === 'alone' || mode === 'legacy') return accompanied === 'alone';
    return (
      user.disability_type === DisabilityType.WHEELCHAIR ||
      user.disability_type === DisabilityType.REDUCED_MOBILITY
    );
  }

  /**
   * Aba “Sozinho”: rotas com score ≥ piso, sem bloqueador `high` em qualquer estágio,
   * sem walk com geometria inválida (`walkSegmentCoordsOk`), e sem flags globais (accessible/slope_warning).
   * Política completa em `docs/ACCESSIBILITY_POLICY.md`.
   */
  private isRouteSuitableForAlone(
    route: Awaited<ReturnType<RoutesService['enrichSingleRouteOption']>>,
  ): boolean {
    if (route.accessible === false) return false;
    if (route.slope_warning === true) return false;
    const stages = route.stages ?? [];
    for (const s of stages) {
      if (
        s.accessibility_report?.blockers?.some((b) => b.severity === 'high')
      ) {
        return false;
      }
    }
    const walkStages = stages.filter((s) => isWalkStageMode(s.mode));
    for (const s of walkStages) {
      if (!walkSegmentCoordsOk(s)) return false;
    }
    return computeRouteScore(route) >= ROUTES_ALONE_MIN_SCORE;
  }

  /** Menor pontuação = trechos a pé “menos acidentados” (ordena aba Acompanhado). */
  private walkHazardScore(
    route: Awaited<ReturnType<RoutesService['enrichSingleRouteOption']>>,
  ): number {
    let score = 0;
    if (route.slope_warning) score += 2;
    for (const s of route.stages ?? []) {
      if (!isWalkStageMode(s.mode)) continue;
      if (s.accessible === false) score += 10;
      if (s.slope_warning) score += 5;
      const w = `${s.warning ?? ''}`.trim();
      if (w.length > 0) score += 3;
    }
    return score;
  }

  /**
   * 0–100 no JSON: **maior = mais acessível**.
   * Penalidades: rota inacessível, inclinação, trechos a pé com alerta/Gemini, e um pouco de
   * caminhada total (desempate entre rotas “limpas”).
   */
  private computeAccessibilityScore(
    route: Awaited<ReturnType<RoutesService['enrichSingleRouteOption']>>,
  ): number {
    return computeRouteScore(route);
  }

  /**
   * Executa o agente LLM (Gemini) sobre as rotas analisadas.
   * Telemetria mínima (modelo, latência) e isolamento de erros — nunca faz a
   * requisição HTTP do `checkRoute` quebrar.
   */
  private async runAccessibilityAgent(args: {
    analyzedRoutes: Awaited<ReturnType<RoutesService['enrichSingleRouteOption']>>[];
    user: User;
    requestId: string;
    wheelchairRouting: boolean;
  }): Promise<{
    output: AccessibilityAgentOutput | null;
    model: string;
    latencyMs: number;
  }> {
    if (!this.accessibilityAgent.isEnabled()) {
      return { output: null, model: this.accessibilityAgent.model, latencyMs: 0 };
    }
    const persona = this.resolveAgentPersona(args.user);
    const input = this.accessibilityAgent.buildInput(
      args.analyzedRoutes,
      persona,
      {
        requestId: args.requestId,
        wheelchairRouting: args.wheelchairRouting,
      },
    );
    const startedAt = Date.now();
    try {
      const output = await this.accessibilityAgent.analyze(input);
      return {
        output,
        model: this.accessibilityAgent.model,
        latencyMs: Date.now() - startedAt,
      };
    } catch (err) {
      this.logger.warn(
        `[checkRoute] agente de acessibilidade falhou: ${(err as Error).message}`,
      );
      return {
        output: null,
        model: this.accessibilityAgent.model,
        latencyMs: Date.now() - startedAt,
      };
    }
  }

  /**
   * Aplica os vereditos do agente sobre o particionamento determinístico.
   * Sem agente (ou em fallback heurístico), devolve o particionamento original.
   *
   * Regras:
   *  - Cada rota recebe `agent_verdict` (score, warnings, rationale, persona notes).
   *  - O agente NÃO decide a aba. A aba vem do score determinístico (faixas 80–100 / 60–79).
   */
  private applyAgentPartition<
    A extends {
      agent_verdict: AgentRouteVerdict | null;
      search_profile: 'alone';
    },
    C extends {
      agent_verdict: AgentRouteVerdict | null;
      search_profile: 'companied';
    },
  >(args: {
    baseAlone: A[];
    baseCompanied: C[];
    agentOutput: AccessibilityAgentOutput | null;
  }): {
    routesAlone: Array<A | (Omit<C, 'search_profile'> & { search_profile: 'alone' })>;
    routesCompanied: Array<C | (Omit<A, 'search_profile'> & { search_profile: 'companied' })>;
    agentMeta:
      | {
          enabled: true;
          fallback: boolean;
          partitionSummary?: string;
        }
      | null;
  } {
    const baseAlone = args.baseAlone;
    const baseCompanied = args.baseCompanied;
    const agentOutput = args.agentOutput;

    if (!agentOutput) {
      return {
        routesAlone: baseAlone,
        routesCompanied: baseCompanied,
        agentMeta: null,
      };
    }

    // Os routeIds são determinísticos (`r${idx}`), na ordem de `analyzedRoutes`,
    // que é a mesma ordem de `partitioned.alone ∪ partitioned.companied`. Para
    // mapear veredito ↔ rota original, reconstruímos a ordem global concatenando
    // alone (na ordem do top-K) + companied (idem).
    const ordered: Array<A | C> = [...baseAlone, ...baseCompanied];
    const verdictById = new Map(
      agentOutput.routes.map((v) => [v.routeId, v]),
    );

    // Só anexa veredito; não move entre abas nem reordena.
    ordered.forEach((route, idx) => {
      const verdict = verdictById.get(`r${idx}`) ?? null;
      route.agent_verdict = verdict;
    });

    return {
      routesAlone: baseAlone,
      routesCompanied: baseCompanied,
      agentMeta: {
        enabled: true,
        fallback: agentOutput.fallback === true,
        partitionSummary: agentOutput.partitionSummary,
      },
    };
  }

  /**
   * Garante que as duas abas não voltem vazias quando há ao menos 1 rota.
   *
   * Regra de produto (temporária/UX): sempre exibimos pelo menos 1 opção em "Sozinho"
   * e 1 em "Acompanhado". Se não houver nenhuma rota elegível para Sozinho, repetimos
   * a melhor alternativa disponível com um aviso explícito.
   */
  private ensureNonEmptyTabs<
    A extends {
      search_profile: 'alone';
      warning?: string | null;
      accompanied_warning?: string | null;
    },
    C extends {
      search_profile: 'companied';
      warning?: string | null;
      accompanied_warning?: string | null;
    },
  >(args: { routesAlone: A[]; routesCompanied: C[] }): {
    routesAlone: Array<A | (Omit<C, 'search_profile'> & { search_profile: 'alone' })>;
    routesCompanied: Array<C | (Omit<A, 'search_profile'> & { search_profile: 'companied' })>;
  } {
    const { routesAlone, routesCompanied } = args;
    const total = routesAlone.length + routesCompanied.length;
    if (total === 0) return { routesAlone, routesCompanied };

    const baseWarning =
      'Nenhuma rota totalmente adequada para esta aba foi encontrada; exibindo a melhor alternativa disponível. Verifique os alertas e siga com atenção.';

    const bestFromAlone = routesAlone[0];
    const bestFromCompanied = routesCompanied[0];

    type AloneOut =
      | A
      | (Omit<C, 'search_profile'> & { search_profile: 'alone' });
    type CompaniedOut =
      | C
      | (Omit<A, 'search_profile'> & { search_profile: 'companied' });

    const promoteToAlone = (r: A | C): AloneOut =>
      ({
        ...(r as object),
        search_profile: 'alone',
        warning: (r as { warning?: string | null }).warning ?? baseWarning,
        accompanied_warning:
          (r as { accompanied_warning?: string | null }).accompanied_warning ??
          'Atenção: esta rota foi promovida para a aba Sozinho como fallback e pode exigir apoio em trechos.',
      }) as AloneOut;

    const promoteToCompanied = (r: A | C): CompaniedOut =>
      ({
        ...(r as object),
        search_profile: 'companied',
        warning: (r as { warning?: string | null }).warning ?? baseWarning,
        accompanied_warning:
          (r as { accompanied_warning?: string | null }).accompanied_warning ??
          null,
      }) as CompaniedOut;

    const bestOverall = (bestFromAlone ?? bestFromCompanied) as A | C;

    const aloneOut: AloneOut[] =
      routesAlone.length > 0 ? routesAlone : [promoteToAlone(bestOverall)];
    const companiedOut: CompaniedOut[] =
      routesCompanied.length > 0
        ? routesCompanied
        : [promoteToCompanied(bestOverall)];

    return { routesAlone: aloneOut, routesCompanied: companiedOut };
  }

  private coordsFromOptionalArgs(
    lat?: number,
    lon?: number,
  ): { lat: number; lon: number } | null {
    if (typeof lat !== 'number' || typeof lon !== 'number') return null;
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) return null;
    return { lat, lon };
  }

  private haversineDistanceMeters(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371000;
    const toRad = (d: number) => (d * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  }

  /** Orçamento total de `checkRoute` (server-side). Cliente tem cap de 15s; aqui ~13s para folga de rede. */
  private static readonly CHECK_ROUTE_DEADLINE_MS = (() => {
    const raw = `${process.env.ROUTES_CHECK_DEADLINE_MS ?? ''}`.trim();
    const n = parseInt(raw, 10);
    /** 28s: o app dispara várias buscas em paralelo; 13s cortava enriquecimento e voltava vazio. */
    if (!Number.isFinite(n) || n < 1000) return 28_000;
    return Math.min(n, 90_000);
  })();

  async checkRoute(
    user_id: number,
    origin: string,
    destination: string,
    transport_type: string,
    accompanied?: string,
    time_filter?: string,
    time_value?: string,
    route_preference?: string,
    route_preferences?: string[],
    origin_title?: string,
    destination_title?: string,
    origin_address?: string,
    destination_address?: string,
    origin_latitude?: number,
    origin_longitude?: number,
    destination_latitude?: number,
    destination_longitude?: number,
  ): Promise<object> {
    const requestId = makeRouteCheckRequestId(user_id);
    const routeTelemetry = new RouteCheckTelemetry(this.logger, requestId);
    const deadline = makeDeadline(RoutesService.CHECK_ROUTE_DEADLINE_MS);
    try {
      routeTelemetry.mark('accepted', {
        user_id,
        transport_type,
        accompanied: accompanied ?? null,
      });
      this.logger.log(
        `[checkRoute] payload received: ${JSON.stringify({
          requestId,
          user_id,
          origin,
          destination,
          transport_type,
          accompanied: accompanied ?? null,
          time_filter: time_filter ?? null,
          time_value: time_value ?? null,
          route_preference: route_preference ?? null,
          route_preferences: route_preferences ?? null,
        })}`,
      );
      const user = await this.usersRepository.findOne({ where: { id: user_id } });
      if (!user) {
        throw new NotFoundException(`Usuário com id ${user_id} não encontrado`);
      }
      routeTelemetry.mark('user_loaded');
      this.logger.log(
        `[checkRoute] resolved user: ${JSON.stringify({
          requestId,
          id: user.id,
          disability_type: user.disability_type ?? null,
        })}`,
      );
      this.logger.log(
        `[checkRoute] route query params: ${JSON.stringify({
          origin,
          destination,
          transport_type,
          route_preference: route_preference ?? null,
          route_preferences: route_preferences ?? null,
        })}`,
      );

      const wantsWalking =
        transport_type === 'walking' ||
        transport_type === 'walk' ||
        transport_type === 'foot';

      const originCoordinates =
        this.coordsFromOptionalArgs(origin_latitude, origin_longitude) ??
        (await this.nominatimService.getCoordinates(origin));
      const destinationCoordinates =
        this.coordsFromOptionalArgs(destination_latitude, destination_longitude) ??
        (await this.nominatimService.getCoordinates(
          destination,
          originCoordinates ?? undefined,
        ));
      routeTelemetry.mark('geocode_done', {
        hasOrigin: !!originCoordinates,
        hasDestination: !!destinationCoordinates,
      });

      if (originCoordinates && destinationCoordinates) {
        const airM = this.haversineDistanceMeters(
          originCoordinates.lat,
          originCoordinates.lon,
          destinationCoordinates.lat,
          destinationCoordinates.lon,
        );
        const enforceMaxAir = ['1', 'true', 'yes', 'on'].includes(
          `${process.env.ROUTES_ENFORCE_MAX_AIR_DISTANCE ?? ''}`.trim().toLowerCase(),
        );
        if (enforceMaxAir && airM > RoutesService.MAX_ROUTE_AIR_DISTANCE_M) {
          throw new BadRequestException(
            'A busca de trajetos está limitada a no máximo 150 km entre origem e destino (distância em linha reta).',
          );
        }
      }

      let routeOptions: RouteOption[] | null = null;
      if (wantsWalking) {
        routeOptions = await this.getWalkingRouteOptionsWithHere(origin, destination);
      } else {
        const tfNorm = (time_filter ?? '').trim().toLowerCase();
        const preferOtp =
          !time_filter ||
          tfNorm === '' ||
          tfNorm === 'leave_now';

        if (originCoordinates && destinationCoordinates && preferOtp) {
          const otpRoutes = await this.otpService.planRoute(
            originCoordinates.lat,
            originCoordinates.lon,
            destinationCoordinates.lat,
            destinationCoordinates.lon,
            this.otpWheelchairRouting(user, accompanied),
          );
          if (otpRoutes && otpRoutes.length > 0) {
            this.logger.log('[checkRoute] OTP retornou rotas, usando resultado OTP');
            routeOptions = otpRoutes;
          }
        }

        if (!routeOptions || routeOptions.length === 0) {
          routeOptions = await this.googleRoutesService.getRouteOptions(
            origin,
            destination,
            transport_type,
            {
              timeFilter: time_filter,
              timeValue: time_value,
            },
          );
        }
      }
      this.logger.log(
        `[checkRoute] raw route options found: ${routeOptions?.length ?? 0}`,
      );
      routeTelemetry.mark('routes_fetched', {
        count: routeOptions?.length ?? 0,
        wantsWalking,
      });

      if (!routeOptions || routeOptions.length === 0) {
        const emptyResponse = {
          route: { origin, destination },
          routes: [],
          routes_alone: [],
          routes_companied: [],
        };
        routeTelemetry.mark('response_empty_no_raw_routes');
        this.logger.log(
          `[checkRoute] final response: ${JSON.stringify({
            requestId,
            route: emptyResponse.route,
            routesCount: emptyResponse.routes.length,
          })}`,
        );
        return emptyResponse;
      }

      routeOptions = this.applyTimeFilter(routeOptions, time_filter);
      const prefFlags = this.normalizeRoutePreferences(
        route_preferences,
        route_preference,
      );
      routeOptions = this.applyRoutePreferences(routeOptions, prefFlags);

      /**
       * Alternativas em paralelo — cada uma tem sua própria lista de estágios (sem estado compartilhado).
       * `enrichSingleRouteOption` recebe o deadline para abortar fontes lentas (Gemini, Overpass, ORS).
       */
      const analyzedRoutes = await Promise.all(
        routeOptions.map((option) =>
          this.enrichSingleRouteOption(option, deadline),
        ),
      );
      routeTelemetry.mark('enrich_done', {
        alternatives: analyzedRoutes.length,
        deadline_remaining_ms: deadline.remaining(),
      });

      this.logFusionSummaries(routeTelemetry, analyzedRoutes);

      const partitioned = partitionRoutesByScore(analyzedRoutes, {
        aloneMax: ROUTES_ALONE_MAX,
        companiedMax: ROUTES_COMPANIED_MAX,
      });

      const baseRoutesAlone = partitioned.alone.map((route) => ({
        ...route,
        search_profile: 'alone' as const,
        warning: null,
        accompanied_warning: null,
        agent_verdict: null as AgentRouteVerdict | null,
      }));
      const baseRoutesCompanied = partitioned.companied.map((route) => {
        const hasHigh = (route.stages ?? []).some((s) =>
          s.accessibility_report?.blockers?.some((b) => b.severity === 'high'),
        );
        const messy = !route.stages.every((s) => s.accessible);
        const hazard = this.walkHazardScore(route) > 0 || route.slope_warning;
        const attention = hasHigh || messy || hazard;
        return {
          ...route,
          search_profile: 'companied' as const,
          warning: attention
            ? 'Este trajeto contém trechos com obstáculos — atenção ao deslocamento com apoio.'
            : route.warning,
          accompanied_warning: null,
          agent_verdict: null as AgentRouteVerdict | null,
        };
      });

      // Camada do agente LLM (Gemini): re-rotula `alone`/`accompanied` com base no
      // painel multi-fonte e na persona do usuário. Em caso de erro/desabilitado,
      // o fallback mantém o particionamento determinístico atual.
      const agentRun = await this.runAccessibilityAgent({
        analyzedRoutes,
        user,
        requestId,
        wheelchairRouting: this.otpWheelchairRouting(user, accompanied),
      });
      const {
        routesAlone: afterAgentAlone,
        routesCompanied: afterAgentCompanied,
        agentMeta,
      } = this.applyAgentPartition({
        baseAlone: baseRoutesAlone,
        baseCompanied: baseRoutesCompanied,
        agentOutput: agentRun.output,
      });
      const { routesAlone, routesCompanied } = this.ensureNonEmptyTabs({
        routesAlone: afterAgentAlone,
        routesCompanied: afterAgentCompanied,
      });
      if (agentRun.output) {
        routeTelemetry.mark('agent_done', {
          fallback: agentRun.output.fallback === true,
          model: agentRun.model,
          latency_ms: agentRun.latencyMs,
          routes: agentRun.output.routes.length,
        });
      }

      const searchProfileMeta =
        accompanied === 'alone' ? ('alone' as const) : ('companied' as const);
      const legacyRoutes =
        accompanied === 'alone' ? routesAlone : routesCompanied;

      this.logger.log(
        `[checkRoute] partition alone=${routesAlone.length} companied=${routesCompanied.length}`,
      );
      routeTelemetry.mark('partition_done', {
        alone: routesAlone.length,
        companied: routesCompanied.length,
      });

      if (
        routesAlone.length === 0 &&
        routesCompanied.length === 0
      ) {
        routeTelemetry.mark('response_empty_after_partition');
        this.logger.warn(
          '[checkRoute] lista vazia após análise — retornando sem persistir.',
        );
        return {
          route: { origin, destination },
          routes: [],
          routes_alone: [],
          routes_companied: [],
          search_profile: searchProfileMeta,
        };
      }

      const bestRoute = routesAlone[0] ?? routesCompanied[0];

      const savedRoute = await this.saveRoute({
        user_id,
        origin,
        destination,
        transport_type,
        accompanied: accompanied ?? 'companied',
        accessible: bestRoute.accessible,
        originTitle: origin_title?.trim() ? origin_title.trim() : null,
        destinationTitle: destination_title?.trim() ? destination_title.trim() : null,
        originAddress: origin_address?.trim() || origin?.trim() || null,
        destinationAddress: destination_address?.trim() || destination?.trim() || null,
      });

      const degraded = deadline.expired();
      const includeFusionDebug = process.env.NODE_ENV !== 'production';
      const response = {
        route: savedRoute,
        routes: legacyRoutes,
        routes_alone: routesAlone,
        routes_companied: routesCompanied,
        search_profile: searchProfileMeta,
        ...(agentMeta ? { agent: agentMeta } : {}),
        ...(degraded ? { degraded: true, degraded_reason: 'time_budget' } : {}),
        ...(includeFusionDebug
          ? {
              fusion_debug: {
                requestId,
                routes: analyzedRoutes.map((r) => ({
                  total_duration: r.total_duration,
                  fusion: r.accessibility_fusion
                    ? {
                        score: r.accessibility_fusion.score,
                        state: r.accessibility_fusion.state,
                        confidence: r.accessibility_fusion.confidence,
                        alone_eligible: r.accessibility_fusion.alone_eligible,
                        companied_recommended_reason:
                          r.accessibility_fusion.companied_recommended_reason,
                        sourcesUsed: r.accessibility_fusion.sourcesUsed,
                        blockerCounts: r.accessibility_fusion.blockerCounts,
                      }
                    : null,
                })),
              },
            }
          : {}),
      };

      if (user.fcm_token) {
        const alertRoute = [...routesAlone, ...routesCompanied].find(
          (route) => route.slope_warning || (route.weather?.rain ?? 0) > 0,
        );
        if (alertRoute) {
          if (alertRoute.slope_warning) {
            await this.safeSendRouteAlert(user.fcm_token);
          }
          if ((alertRoute.weather?.rain ?? 0) > 0) {
            await this.safeSendWeatherAlert(
              user.fcm_token,
              alertRoute.weather?.condition ?? 'Chuva',
            );
          }
        }
      }
      routeTelemetry.mark('success', {
        routeId: savedRoute.id,
        legacyRoutesCount: response.routes.length,
      });
      this.logger.log(
        `[checkRoute] final response: ${JSON.stringify({
          requestId,
          routeId: savedRoute.id,
          routesCount: response.routes.length,
          bestRouteAccessible: bestRoute.accessible,
        })}`,
      );
      return response;
    } catch (error) {
      if (error instanceof HttpException) {
        this.logger.error(
          `[checkRoute] handled HttpException: ${JSON.stringify({
            requestId,
            message: error.message,
          })}`,
          error.stack,
        );
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      const stack = error instanceof Error ? error.stack : undefined;
      this.logger.error(
        `Erro ao calcular rota: ${JSON.stringify({ requestId, message })}`,
        stack,
      );
      throw new InternalServerErrorException('Erro ao calcular rota');
    } finally {
      deadline.cancel();
    }
  }

  /**
   * Enriquece uma alternativa em paralelo, com orçamento cooperativo (`deadline`).
   *
   * Pipeline (ver `ACCESSIBILITY_ROUTE_SPECIALIST.md` §5):
   *  - Fase A (paralela por trecho walk): imagens + elevação + sinais estruturais (Overpass+ORS).
   *  - Fase A.2 (paralela): Gemini visão só nos walks "quentes" pré-fusão + ainda dentro do limite global.
   *  - Fase B (fusão): função pura `fuseWalkLeg` agrega tudo em LegFusionResult.
   *  - Fase C (rota): `fuseRoute` agrega legs num score composto e flags.
   *  - POIs/Uber/clima: paralelo no fim, com fallback null se faltar tempo.
   */
  private async enrichSingleRouteOption(
    option: RouteOption,
    deadline?: Deadline,
  ) {
    type WalkCollect = {
      stage: RouteStage;
      signals: WalkLegSignals;
    };

    const collectWalk = async (stage: RouteStage): Promise<WalkCollect> => {
      const walkCoordsOk = walkSegmentCoordsOk(stage);
      const declaredWalkMeters = parseWalkDistanceToMeters(stage.distance);

      const imagesPromise = (async () => {
        try {
          const urls = await this.geminiService.resolveWalkStageImageUrls(stage);
          (stage as RouteStage & { street_view_images?: string[] | null }).street_view_images =
            urls.length > 0 ? urls : null;
          stage.street_view_image = urls[0] ?? null;
        } catch (imgErr) {
          this.logger.warn(
            `[checkRoute] imagens walk ignoradas: ${(imgErr as Error).message}`,
          );
        }
      })();
      const elevationPromise = walkCoordsOk
        ? this.elevationService
            .getElevation([stage.location, stage.end_location])
            .catch(() => [] as Array<{ elevation: number; accessible: boolean; lat: number; lng: number }>)
        : Promise.resolve(
            [] as Array<{ elevation: number; accessible: boolean; lat: number; lng: number }>,
          );
      const structuralPromise = this.walkAccessibilityEngine
        .collectWalkLegStructuralSignals({
          stage,
          slopePercent: null,
          declaredWalkMeters,
        })
        .catch((e) => {
          this.logger.warn(
            `[checkRoute] sinais estruturais walk ignorados: ${(e as Error).message}`,
          );
          return {
            walkCoordsOk,
            slopePercent: null,
            declaredWalkMeters,
            overpass: { ok: false as const, reason: 'error' as const },
            ors: { status: 'skipped' as const, reason: 'error' as const },
          };
        });

      const imagesGuarded = deadline
        ? deadline.race(imagesPromise, { fallback: undefined, label: 'walk_images', perCallMs: 6_000 })
        : imagesPromise;
      const elevationGuarded = deadline
        ? deadline.race(elevationPromise, { fallback: [], label: 'elevation', perCallMs: 4_000 })
        : elevationPromise;
      const structuralGuarded = deadline
        ? deadline.race(structuralPromise, {
            fallback: {
              walkCoordsOk,
              slopePercent: null,
              declaredWalkMeters,
              overpass: { ok: false as const, reason: 'timeout' as const },
              ors: { status: 'skipped' as const, reason: 'timeout' as const },
            },
            label: 'walk_structural',
            perCallMs: 7_000,
          })
        : structuralPromise;

      const [, elevations, structural] = await Promise.all([
        imagesGuarded,
        elevationGuarded,
        structuralGuarded,
      ]);

      let slopePercent: number | null = null;
      if (walkCoordsOk && elevations.length >= 2) {
        slopePercent = this.calculateSlopePercentage(
          elevations[0].elevation,
          elevations[1].elevation,
          stage.location,
          stage.end_location,
        );
      }

      const signals: WalkLegSignals = {
        walkCoordsOk,
        slopePercent,
        declaredWalkMeters,
        overpass: structural.overpass,
        ors: structural.ors,
      };
      return { stage, signals };
    };

    const enrichTransitImages = async (stage: RouteStage) => {
      try {
        const promise =
          stage.mode === 'bus' || stage.mode === 'subway'
            ? this.geminiService.resolveTransitStopPhoto(stage)
            : this.geminiService.resolveStageStreetViewImage(stage);
        const url = deadline
          ? await deadline.race(promise, { fallback: null, label: 'transit_image', perCallMs: 4_000 })
          : await promise;
        stage.street_view_image = url ?? null;
      } catch (imgErr) {
        this.logger.warn(
          `[checkRoute] imagem transit ignorada: ${(imgErr as Error).message}`,
        );
      }
      return stage;
    };

    // Fase A — coleta paralela por trecho.
    const stageEnrichments: Promise<unknown>[] = [];
    const walkResults: WalkCollect[] = [];
    for (const stage of option.stages) {
      if (isWalkStageMode(stage.mode)) {
        stageEnrichments.push(collectWalk(stage).then((r) => walkResults.push(r)));
      } else {
        stageEnrichments.push(enrichTransitImages(stage));
      }
    }
    await Promise.all(stageEnrichments);

    // Pré-fusão (sem Gemini ainda) — só para priorizar Gemini nos walks "suspeitos".
    const preFusion = walkResults.map((r) => ({
      ...r,
      preLeg: this.fusionService.fuseWalkLeg(r.signals),
    }));

    const isPreSuspect = (state: LegFusionResult['state']): boolean =>
      state === 'unsafe' || state === 'caution' || state === 'unknown';
    const hot = preFusion.filter((r) => r.signals.walkCoordsOk && isPreSuspect(r.preLeg.state));
    const cold = preFusion.filter((r) => r.signals.walkCoordsOk && !isPreSuspect(r.preLeg.state));
    const orderedWalksForGemini = [...hot, ...cold].slice(
      0,
      RoutesService.MAX_WALKING_STAGES_TO_ANALYZE,
    );

    // Fase A.2 — Gemini visão em paralelo, só para os priorizados.
    await Promise.all(
      orderedWalksForGemini.map(async (item) => {
        if (deadline?.expired()) {
          item.signals.gemini = { state: 'unknown', reason: 'timeout' };
          return;
        }
        const midLat = (item.stage.location.lat + item.stage.end_location.lat) / 2;
        const midLng = (item.stage.location.lng + item.stage.end_location.lng) / 2;
        try {
          const promise = this.geminiService.analyzeWalkAccessibilityForFusion(
            midLat,
            midLng,
          );
          const result = deadline
            ? await deadline.race(promise, {
                fallback: { state: 'unknown' as const, reason: 'timeout' as const },
                label: 'gemini_vision',
                perCallMs: 6_000,
              })
            : await promise;
          item.signals.gemini = result;
        } catch (gemErr) {
          this.logger.warn(
            `[checkRoute] Gemini walk skip: ${(gemErr as Error).message}`,
          );
          item.signals.gemini = { state: 'unknown', reason: 'error' };
        }
      }),
    );

    // Fase B — fusão final por trecho (puro). Aplicamos resultado nos campos legados
    // (`accessible`, `warning`, `slope_warning`, `accessibility_report`) para manter compat,
    // e expomos o resultado completo em `accessibility_fusion`.
    for (const item of walkResults) {
      const finalLeg = this.fusionService.fuseWalkLeg(item.signals);
      this.applyLegFusionToStage(item.stage, finalLeg, item.signals);
      (item as WalkCollect & { fusion?: LegFusionResult }).fusion = finalLeg;
    }

    const analyzedStages: RouteStage[] = option.stages;

    // Fase C — fusão por rota (composição dos legs walk).
    const legResults: LegFusionResult[] = walkResults.map(
      (r) =>
        (r as WalkCollect & { fusion: LegFusionResult }).fusion ??
        this.fusionService.fuseWalkLeg(r.signals),
    );
    const routeFusion = this.fusionService.fuseRoute(legResults);

    const routeAccessible = analyzedStages.every((s) => s.accessible);
    const slope_warning = analyzedStages.some(
      (stage) => stage.slope_warning === true,
    );
    const firstPoint = analyzedStages[0]?.location;
    const guarded = <T>(p: Promise<T>, label: string, fallback: T): Promise<T> =>
      deadline
        ? deadline.race(p, { fallback, label, perCallMs: 4_000 })
        : p.catch(() => fallback);
    const [weather, accessibilityFeatures, wheelmapPlaces, foursquarePlaces] =
      firstPoint
        ? await Promise.all([
            guarded(this.safeGetWeather(firstPoint.lat, firstPoint.lng), 'weather', null),
            guarded(
              this.safeGetAccessibilityFeatures(firstPoint.lat, firstPoint.lng),
              'osm_features',
              null,
            ),
            guarded(this.safeGetWheelmapPlaces(firstPoint.lat, firstPoint.lng), 'wheelmap', []),
            guarded(this.safeGetFoursquarePlaces(firstPoint.lat, firstPoint.lng), 'foursquare', []),
          ])
        : [null, null, [], []];
    const nearbyAccessiblePlaces = [
      ...wheelmapPlaces,
      ...foursquarePlaces,
    ].slice(0, 20);
    const lastPoint = analyzedStages[analyzedStages.length - 1]?.end_location;
    const uberEstimates =
      firstPoint && lastPoint
        ? await guarded(this.safeGetUberEstimates(firstPoint, lastPoint), 'uber', [])
        : [];
    const cheapestUberEstimate =
      uberEstimates.length > 0
        ? uberEstimates.reduce((best, current) => {
            const bestValue = this.extractEstimateValue(best.estimate);
            const currentValue = this.extractEstimateValue(current.estimate);
            return currentValue < bestValue ? current : best;
          })
        : null;
    const uberDeeplink =
      firstPoint && lastPoint
        ? this.uberService.getDeepLink(firstPoint, lastPoint)
        : null;

    return {
      ...option,
      stages: analyzedStages,
      accessible: routeAccessible,
      warning: null,
      accompanied_warning: null,
      weather,
      accessibility_features: accessibilityFeatures
        ? {
            rampas: accessibilityFeatures.rampas,
            pisotatil: accessibilityFeatures.pisotatil,
            banheiros_acessiveis: accessibilityFeatures.banheiros_acessiveis,
          }
        : null,
      slope_warning,
      accessibility_fusion: routeFusion,
      nearby_accessible_places: nearbyAccessiblePlaces,
      uber_estimate: cheapestUberEstimate
        ? {
            product: cheapestUberEstimate.product,
            estimate: cheapestUberEstimate.estimate,
            duration: cheapestUberEstimate.duration,
          }
        : null,
      uber_deeplink: uberDeeplink,
    };
  }

  /**
   * Aplica resultado fusionado ao `RouteStage` mantendo compatibilidade com a API atual:
   *  - `stage.accessible`: true salvo se fusão devolveu `unsafe`.
   *  - `stage.slope_warning`: true se houve evidência `excessive_slope`.
   *  - `stage.warning`: vem da fusão (não exclusivo do Gemini).
   *  - `stage.accessibility_report`: derivado das `evidences` para callers existentes.
   *  - `stage.accessibility_fusion`: resultado completo (UI/observabilidade).
   */
  private applyLegFusionToStage(
    stage: RouteStage,
    leg: LegFusionResult,
    signals: WalkLegSignals,
  ): void {
    stage.accessibility_fusion = leg;

    const blockers: LegAccessibilityBlocker[] = [];
    for (const e of leg.evidences) {
      if (e.metadata?.positive === true) continue;
      if (e.kind === 'source_skipped') continue;
      blockers.push(this.evidenceToLegBlocker(e));
    }
    const sources = Array.from(
      new Set(
        leg.evidences.flatMap((e) => {
          if (e.kind === 'source_skipped') {
            return [`${e.source}_${(e.metadata?.reason as string | undefined) ?? 'skipped'}`];
          }
          if (e.metadata?.positive === true) {
            return [`${e.source}_ok`];
          }
          return [e.source];
        }),
      ),
    );
    const report: LegAccessibilityReport = {
      confidence: leg.confidence,
      blockers,
      sources,
    };
    stage.accessibility_report = report;

    if (leg.state === 'unsafe') {
      stage.accessible = false;
    } else if (leg.state === 'caution') {
      // mantém accessible=true (cliente pode passar acompanhado); warning sinaliza atenção
    } else if (leg.state === 'unknown') {
      // não declaramos `accessible=false` por falta de dado; só registramos warning se for o caso
    }

    const slopeEvidence = leg.evidences.find(
      (e) => e.kind === 'excessive_slope' && e.metadata?.positive !== true,
    );
    if (slopeEvidence) {
      stage.slope_warning = true;
    } else if (signals.slopePercent !== null && signals.slopePercent <= 8) {
      stage.slope_warning = stage.slope_warning ?? false;
    }

    if (leg.warning && !stage.warning) {
      stage.warning = leg.warning;
    }
  }

  private evidenceToLegBlocker(
    e: LegFusionResult['evidences'][number],
  ): LegAccessibilityBlocker {
    const map: Record<string, LegAccessibilityBlocker['type']> = {
      missing_geometry: 'missing_geometry',
      excessive_slope: 'excessive_slope',
      moderate_slope: 'excessive_slope',
      stairs_or_steps: 'stairs_or_steps',
      rough_surface: 'rough_surface',
      no_wheelchair_route: 'ors_no_wheelchair_route',
      wheelchair_detour: 'ors_wheelchair_detour',
      image_obstacle: 'vision_or_llm_warning',
      transit_not_wheelchair: 'transit_not_wheelchair',
    };
    return {
      type: map[e.kind] ?? 'other',
      severity: e.severity,
      detail: e.detail,
    };
  }

  private async saveRoute(data: {
    user_id: number;
    origin: string;
    destination: string;
    transport_type: string;
    accompanied: string;
    accessible: boolean;
    originTitle?: string | null;
    destinationTitle?: string | null;
    originAddress?: string | null;
    destinationAddress?: string | null;
  }): Promise<Routes> {
    if (await this.routesTableHasAccompaniedColumn()) {
      return this.routesRepository.save(
        this.routesRepository.create({
          user_id: data.user_id,
          origin: data.origin,
          destination: data.destination,
          transport_type: data.transport_type,
          accompanied: data.accompanied,
          accessible: data.accessible,
          originTitle: data.originTitle ?? null,
          destinationTitle: data.destinationTitle ?? null,
          originAddress: data.originAddress ?? null,
          destinationAddress: data.destinationAddress ?? null,
        }),
      );
    }

    // Compatibilidade com banco legado sem a coluna "accompanied".
    const rows = await this.routesRepository.query(
      `INSERT INTO routes (user_id, origin, destination, transport_type, accessible)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING *`,
      [
        data.user_id,
        data.origin,
        data.destination,
        data.transport_type,
        data.accessible,
      ],
    );

    const savedRoute = rows[0] as Routes;
    return {
      ...savedRoute,
      accompanied: data.accompanied,
    };
  }

  private async routesTableHasAccompaniedColumn(): Promise<boolean> {
    if (this.hasAccompaniedColumn !== null) {
      return this.hasAccompaniedColumn;
    }

    try {
      const rows = await this.routesRepository.query(
        `SELECT 1
         FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = 'routes'
           AND column_name = 'accompanied'
         LIMIT 1`,
      );
      this.hasAccompaniedColumn = rows.length > 0;
    } catch (error) {
      if (error instanceof QueryFailedError) {
        this.logger.error(
          'Falha ao verificar schema da tabela routes; assumindo coluna accompanied ausente.',
        );
      }
      this.hasAccompaniedColumn = false;
    }

    return this.hasAccompaniedColumn;
  }

  async getRouteById(id: number): Promise<Routes> {
    const route = await this.routesRepository.findOne({ where: { id } });

    if (!route) {
      throw new NotFoundException(`Rota com id ${id} não encontrada`);
    }

    return route;
  }

  async findHistoryByUserId(user_id: number): Promise<Routes[]> {
    return this.routesRepository.find({
      where: { user_id },
      order: { created_at: 'DESC' },
    });
  }

  private calculateSlopePercentage(
    startElevation: number,
    endElevation: number,
    start: { lat: number; lng: number },
    end: { lat: number; lng: number },
  ): number {
    const horizontalDistance = this.calculateDistanceMeters(
      start.lat,
      start.lng,
      end.lat,
      end.lng,
    );
    if (horizontalDistance === 0) {
      return 0;
    }

    return (Math.abs(endElevation - startElevation) / horizontalDistance) * 100;
  }

  private calculateDistanceMeters(
    lat1: number,
    lng1: number,
    lat2: number,
    lng2: number,
  ): number {
    const toRadians = (value: number) => (value * Math.PI) / 180;
    const earthRadius = 6371000;
    const dLat = toRadians(lat2 - lat1);
    const dLng = toRadians(lng2 - lng1);

    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(toRadians(lat1)) *
        Math.cos(toRadians(lat2)) *
        Math.sin(dLng / 2) *
        Math.sin(dLng / 2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return earthRadius * c;
  }

  private extractEstimateValue(estimate: string): number {
    const numbers = estimate.replace(/[^\d,.-]/g, '').replace(',', '.');
    const value = Number.parseFloat(numbers);
    return Number.isNaN(value) ? Number.MAX_SAFE_INTEGER : value;
  }

  private async getWalkingRouteOptionsWithHere(
    origin: string,
    destination: string,
  ): Promise<RouteOption[] | null> {
    const originCoordinates = await this.nominatimService.getCoordinates(origin);
    const destinationCoordinates =
      await this.nominatimService.getCoordinates(
        destination,
        originCoordinates ?? undefined,
      );

    if (!originCoordinates || !destinationCoordinates) {
      return this.googleRoutesService.getWalkingRouteOptions(
        origin,
        destination,
      );
    }

    const hereRoute = await this.hereService.getAccessibleRoute(
      { lat: originCoordinates.lat, lng: originCoordinates.lon },
      { lat: destinationCoordinates.lat, lng: destinationCoordinates.lon },
    );

    if (!hereRoute) {
      return this.googleRoutesService.getWalkingRouteOptions(
        origin,
        destination,
      );
    }

    const sections = hereRoute.sections ?? [];
    let stageNumber = 1;
    const stages: RouteStage[] = sections.map((section: any) => ({
      stage: stageNumber++,
      mode: 'walk',
      instruction:
        section.actions?.[0]?.instruction ??
        'Siga a rota de caminhada acessivel sugerida.',
      distance: `${Math.round(section.summary?.length ?? 0)} m`,
      duration: `${Math.round((section.summary?.duration ?? 0) / 60)} minutos`,
      location: {
        lat: section.departure?.place?.location?.lat ?? originCoordinates.lat,
        lng: section.departure?.place?.location?.lng ?? originCoordinates.lon,
      },
      end_location: {
        lat: section.arrival?.place?.location?.lat ?? destinationCoordinates.lat,
        lng: section.arrival?.place?.location?.lng ?? destinationCoordinates.lon,
      },
      accessible: true,
      warning: null,
      street_view_image: null,
    }));

    const totalDistanceMeters = sections.reduce(
      (acc: number, section: any) => acc + (section.summary?.length ?? 0),
      0,
    );
    const totalDurationMinutes = Math.ceil(
      sections.reduce(
        (acc: number, section: any) => acc + (section.summary?.duration ?? 0),
        0,
      ) / 60,
    );

    return [
      {
        route_id: 1,
        total_distance: `${(totalDistanceMeters / 1000).toFixed(1)} km`,
        total_duration: `${totalDurationMinutes} min`,
        stages,
      },
    ];
  }

  private async safeGetWeather(lat: number, lng: number) {
    try {
      return await this.weatherService.getWeatherForRoute(lat, lng);
    } catch (error) {
      this.logger.warn(
        `Weather indisponível para (${lat}, ${lng}): ${this.getErrorMessage(error)}`,
      );
      return null;
    }
  }

  private async safeGetAccessibilityFeatures(lat: number, lng: number) {
    try {
      return await this.overpassService.getAccessibilityFeatures(lat, lng);
    } catch (error) {
      this.logger.warn(
        `Overpass indisponível para (${lat}, ${lng}): ${this.getErrorMessage(error)}`,
      );
      return null;
    }
  }

  private async safeGetWheelmapPlaces(lat: number, lng: number) {
    try {
      return await this.wheelmapService.getNearbyAccessiblePlaces(lat, lng);
    } catch (error) {
      this.logger.warn(
        `Wheelmap indisponível para (${lat}, ${lng}): ${this.getErrorMessage(error)}`,
      );
      return [];
    }
  }

  private async safeGetFoursquarePlaces(lat: number, lng: number) {
    try {
      return await this.foursquareService.getNearbyPlaces(lat, lng);
    } catch (error) {
      this.logger.warn(
        `Foursquare indisponível para (${lat}, ${lng}): ${this.getErrorMessage(error)}`,
      );
      return [];
    }
  }

  private async safeGetUberEstimates(
    origin: { lat: number; lng: number },
    destination: { lat: number; lng: number },
  ) {
    try {
      return await this.uberService.getEstimate(origin, destination);
    } catch (error) {
      this.logger.warn(
        `Uber estimate indisponível: ${this.getErrorMessage(error)}`,
      );
      return [];
    }
  }

  private async safeSendRouteAlert(token: string) {
    try {
      await this.notificationsService.sendRouteAlert(
        token,
        'Trecho com inclinacao acima de 8% identificado na rota.',
      );
    } catch (error) {
      this.logger.warn(`Falha ao enviar route alert: ${this.getErrorMessage(error)}`);
    }
  }

  private async safeSendWeatherAlert(token: string, condition: string) {
    try {
      await this.notificationsService.sendWeatherAlert(token, condition);
    } catch (error) {
      this.logger.warn(
        `Falha ao enviar weather alert: ${this.getErrorMessage(error)}`,
      );
    }
  }

  private getErrorMessage(error: unknown): string {
    if (error instanceof Error) {
      return error.message;
    }
    return String(error);
  }

  /**
   * Log estruturado da fusão por rota: fontes usadas, contagens de blockers,
   * decisão final (alone_eligible, motivo). Facilita debugging em produção
   * sem expor `fusion_debug` no payload.
   */
  private logFusionSummaries(
    telemetry: RouteCheckTelemetry,
    routes: Array<{
      total_duration?: string;
      accessibility_fusion?: import('./contracts/route-accessibility-fusion.contract').RouteFusionResult;
    }>,
  ): void {
    routes.forEach((route, idx) => {
      const f = route.accessibility_fusion;
      if (!f) return;
      telemetry.mark('fusion_summary', {
        idx,
        total_duration: route.total_duration ?? null,
        score: f.score,
        state: f.state,
        confidence: f.confidence,
        alone_eligible: f.alone_eligible,
        companied_recommended_reason: f.companied_recommended_reason,
        blockers: f.blockerCounts,
        sources: f.sourcesUsed,
        legs: f.legResults.map((leg) => ({
          state: leg.state,
          score: leg.score,
          confidence: leg.confidence,
          sources: leg.sourcesUsed,
          alerts: leg.alerts.length,
        })),
      });
    });
  }
}
