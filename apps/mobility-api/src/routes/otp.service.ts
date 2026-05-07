import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { RouteOption, RouteStage } from './google-routes.service';
import type { LegAccessibilityReport } from './contracts/route-accessibility.contract';
import { detectOtpRegionForRoute } from './utils/otp-region.util';

function readBooleanEnv(key: string, defaultValue: boolean): boolean {
  const raw = `${process.env[key] ?? ''}`.trim().toLowerCase();
  if (!raw) return defaultValue;
  if (['1', 'true', 'yes', 'on'].includes(raw)) return true;
  if (['0', 'false', 'no', 'off'].includes(raw)) return false;
  return defaultValue;
}

function readIntEnv(
  key: string,
  defaultValue: number,
  opts?: { min?: number; max?: number },
): number {
  const raw = `${process.env[key] ?? ''}`.trim();
  if (!raw) return defaultValue;
  const parsed = parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return defaultValue;
  const min = opts?.min ?? Number.NEGATIVE_INFINITY;
  const max = opts?.max ?? Number.POSITIVE_INFINITY;
  return Math.max(min, Math.min(max, parsed));
}

@Injectable()
export class OtpService {
  private readonly logger = new Logger(OtpService.name);
  private readonly otpUrl = `${process.env.OTP_URL ?? ''}`.trim().replace(/\/+$/, '');
  /** Instância OTP dedicada a Montes Claros (porta/host diferentes no Docker). */
  private readonly otpUrlMontesClaros = `${process.env.OTP_URL_MONTES_CLAROS ?? ''}`
    .trim()
    .replace(/\/+$/, '');
  /** Instância OTP dedicada a Brasília / DF. */
  private readonly otpUrlBrasilia = `${process.env.OTP_URL_BRASILIA ?? ''}`
    .trim()
    .replace(/\/+$/, '');
  /** Instância OTP dedicada a São Paulo / SPTrans. */
  private readonly otpUrlSaoPaulo = `${process.env.OTP_URL_SAO_PAULO ?? ''}`
    .trim()
    .replace(/\/+$/, '');
  private readonly otpTimeoutMs = readIntEnv('OTP_TIMEOUT_MS', 4500, {
    min: 1000,
    max: 20000,
  });
  /**
   * Padrão 3500 m: com 1000 m o OTP frequentemente devolve **zero** itinerários
   * (parada inicial longe), e o app parece “nunca achar trajeto”.
   */
  private readonly otpMaxWalkMeters = readIntEnv('OTP_MAX_WALK_METERS', 3500, {
    min: 250,
    max: 20000,
  });
  private readonly otpRequiredInProd = readBooleanEnv(
    'OTP_REQUIRED_IN_PROD',
    true,
  );
  private warnedMissingConfig = false;

  constructor() {
    const isProd = process.env.NODE_ENV === 'production';
    const configured = [
      this.otpUrl,
      this.otpUrlMontesClaros,
      this.otpUrlBrasilia,
      this.otpUrlSaoPaulo,
    ].filter((u) => u.length > 0);

    if (configured.length === 0) {
      const message =
        '[OTP] Nenhuma URL OTP configurada (OTP_URL e/ou OTP_URL_MONTES_CLAROS / OTP_URL_BRASILIA / OTP_URL_SAO_PAULO).';
      if (isProd && this.otpRequiredInProd) {
        throw new Error(message);
      }
      this.logger.warn(`${message} Seguiremos com fallback para Google.`);
      return;
    }

    if (isProd && this.otpRequiredInProd) {
      const locals = configured.filter(
        (u) => u.includes('localhost') || u.includes('127.0.0.1'),
      );
      if (locals.length > 0) {
        throw new Error(
          `[OTP] URL(s) OTP apontam para ambiente local em produção: ${locals.join(', ')}. Configure servidor(es) remoto(s).`,
        );
      }
    }
  }

  async planRoute(
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number,
    wheelchair = false,
    mode = 'TRANSIT,WALK',
  ): Promise<RouteOption[] | null> {
    const base = this.resolveOtpBaseUrl(
      originLat,
      originLng,
      destLat,
      destLng,
    );
    if (!base) {
      if (!this.warnedMissingConfig) {
        this.warnedMissingConfig = true;
        this.logger.warn(
          '[OTP] OTP_URL ausente; OTP desabilitado nesta instância. Usando fallback para Google.',
        );
      }
      return null;
    }

    const url =
      `${base}/otp/routers/default/plan?` +
      `fromPlace=${originLat},${originLng}&` +
      `toPlace=${destLat},${destLng}&` +
      `mode=${mode}&` +
      `wheelchair=${wheelchair}&` +
      `numItineraries=3&` +
      `maxWalkDistance=${this.otpMaxWalkMeters}`;

    try {
      const { data } = await axios.get(url, { timeout: this.otpTimeoutMs });
      const itinCount = Array.isArray(data?.plan?.itineraries)
        ? data.plan.itineraries.length
        : 0;
      if (itinCount === 0 && data?.plan?.error) {
        this.logger.warn(
          `[OTP] plan sem itinerários: ${JSON.stringify(data.plan.error)}`,
        );
      }
      return this.mapOtpResponse(data, wheelchair);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.logger.warn(
        `[OTP] falhou (${message}), usando Google como fallback`,
      );
      return null;
    }
  }

  /**
   * Escolhe a URL base do OTP conforme a região da rota.
   * - Com `OTP_URL_MONTES_CLAROS` / `OTP_URL_BRASILIA`, roteia por bbox (ver `otp-region.util.ts`).
   * - Sem URLs regionais, usa só `OTP_URL` (comportamento legado — um servidor, um grafo).
   */
  private resolveOtpBaseUrl(
    originLat: number,
    originLng: number,
    destLat: number,
    destLng: number,
  ): string | null {
    const hasRegional =
      this.otpUrlMontesClaros.length > 0 ||
      this.otpUrlBrasilia.length > 0 ||
      this.otpUrlSaoPaulo.length > 0;

    if (!hasRegional) {
      return this.otpUrl || null;
    }

    const region = detectOtpRegionForRoute(
      originLat,
      originLng,
      destLat,
      destLng,
    );

    if (region === 'montes_claros') {
      const u = this.otpUrlMontesClaros || this.otpUrl;
      return u || null;
    }
    if (region === 'brasilia') {
      const u = this.otpUrlBrasilia || this.otpUrl;
      return u || null;
    }
    if (region === 'sao_paulo') {
      const u = this.otpUrlSaoPaulo || this.otpUrl;
      return u || null;
    }

    return (
      this.otpUrl ||
      this.otpUrlMontesClaros ||
      this.otpUrlBrasilia ||
      this.otpUrlSaoPaulo ||
      null
    );
  }

  private mapOtpResponse(data: any, wheelchair: boolean): RouteOption[] {
    return (
      data.plan?.itineraries?.map((itinerary: any, itineraryIndex: number) => {
        const stages: RouteStage[] = (itinerary.legs ?? []).map(
          (leg: any, legIndex: number) => {
            const points = leg.legGeometry?.points
              ? this.decodePolyline(leg.legGeometry.points)
              : [];
            const startPoint = points[0] ?? {
              lat: Number(leg.from?.lat ?? 0),
              lng: Number(leg.from?.lon ?? 0),
            };
            const endPoint = points[points.length - 1] ?? {
              lat: Number(leg.to?.lat ?? 0),
              lng: Number(leg.to?.lon ?? 0),
            };

            const transitAccessibilityReport: LegAccessibilityReport | undefined =
              wheelchair &&
              leg.mode !== 'WALK' &&
              leg.wheelchairAccessible === false
                ? {
                    confidence: 'high',
                    blockers: [
                      {
                        type: 'transit_not_wheelchair',
                        severity: 'medium',
                        detail:
                          'OpenTripPlanner indicou este trecho de transporte como não acessível para cadeira de rodas.',
                      },
                    ],
                    sources: ['otp_transit_wheelchair_flag'],
                  }
                : undefined;

            const stage: RouteStage = {
              stage: legIndex + 1,
              mode:
                leg.mode === 'WALK' ? 'walk' : leg.mode === 'BUS' ? 'bus' : 'subway',
              instruction:
                leg.mode === 'WALK'
                  ? `Caminhe até ${leg.to?.name ?? 'destino'}`
                  : `Embarque em ${leg.from?.name ?? 'ponto'} — ${leg.route ?? leg.routeShortName ?? 'linha'}`,
              distance: `${Math.round(Number(leg.distance ?? 0))}m`,
              duration: `${Math.round(Number(leg.duration ?? 0) / 60)} min`,
              accessible: !leg.slopeExceeded,
              warning: leg.slopeExceeded
                ? 'Trecho com inclinação acima de 8% — pode ser difícil'
                : null,
              line_code: leg.routeShortName ?? null,
              stop_name: leg.from?.name ?? null,
              location: { lat: Number(startPoint.lat), lng: Number(startPoint.lng) },
              end_location: { lat: Number(endPoint.lat), lng: Number(endPoint.lng) },
              departure: leg.from?.name ?? undefined,
              arrival: leg.to?.name ?? undefined,
              street_view_image: null,
            };
            if (transitAccessibilityReport) {
              stage.accessibility_report = transitAccessibilityReport;
            }
            return stage;
          },
        );

        return {
          route_id: itineraryIndex + 1,
          total_duration: `${Math.round(Number(itinerary.duration ?? 0) / 60)} minutos`,
          total_distance: this.calcDistance(itinerary.legs ?? []),
          stages,
        } as RouteOption & {
          accessible: boolean;
          slope_warning: boolean;
          accompanied_warning: string | null;
        };
      }) ?? []
    );
  }

  private calcDistance(legs: any[]): string {
    const total = legs.reduce(
      (acc: number, l: any) => acc + Number(l.distance ?? 0),
      0,
    );
    return total > 1000 ? `${(total / 1000).toFixed(1)} km` : `${Math.round(total)}m`;
  }

  private decodePolyline(encoded: string): { lat: number; lng: number }[] {
    const points: { lat: number; lng: number }[] = [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    while (index < encoded.length) {
      let b: number;
      let shift = 0;
      let result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      lat += result & 1 ? ~(result >> 1) : result >> 1;
      shift = 0;
      result = 0;
      do {
        b = encoded.charCodeAt(index++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      lng += result & 1 ? ~(result >> 1) : result >> 1;
      points.push({ lat: lat / 1e5, lng: lng / 1e5 });
    }
    return points;
  }
}
