/**
 * Especialista de acessibilidade de trajetos — motor de FUSÃO (puro).
 *
 * Recebe sinais brutos de várias fontes para um trecho a pé, normaliza em
 * `Evidence[]`, combina segundo regras explícitas e produz `LegFusionResult`.
 * No nível da rota, agrega legs em `RouteFusionResult` com `score` composto,
 * `alone_eligible` (top-K + piso, vetos duros restritos) e motivo de Acompanhado.
 *
 * Política e princípios: ../../ACCESSIBILITY_ROUTE_SPECIALIST.md
 *
 * Este serviço **não faz I/O**. A coleta paralela vive em `RoutesService`.
 *
 * MATRIZ FONTE × O QUE EXTRAI
 * ┌──────────────────┬─────────────────────────────────────────────────────────┐
 * │ overpass         │ degraus (high), superfície irregular (medium)           │
 * │ ors_wheelchair   │ ausência de rota cadeira (medium), desvio grande (low)  │
 * │ elevation        │ inclinação > 8% (high), 5–8% (medium)                   │
 * │ gemini_vision    │ visão da calçada (uma evidência entre várias)           │
 * │ otp              │ sinal `wheelchairAccessible` por leg de trânsito        │
 * │ here / google    │ contribuem geometria — fusão consome via outros sinais  │
 * │ structural_engine│ fallback genérico quando o motor estrutural foi pulado  │
 * └──────────────────┴─────────────────────────────────────────────────────────┘
 */

import { Injectable } from '@nestjs/common';
import type {
  AccessibilityState,
  Evidence,
  LegFusionResult,
  RouteFusionResult,
  WalkLegSignals,
} from './contracts/route-accessibility-fusion.contract';
import type { LegAccessibilityConfidence } from './contracts/route-accessibility.contract';
import { ROUTES_ALONE_MIN_SCORE } from './utils/route-scoring.util';

/** Ranking interno (severity x confidence → penalidade). */
const PENALTY_TABLE: Record<
  'high' | 'medium' | 'low',
  Record<LegAccessibilityConfidence, number>
> = {
  high: { high: 28, medium: 20, low: 10 },
  medium: { high: 14, medium: 10, low: 5 },
  low: { high: 4, medium: 3, low: 2 },
};

const STATE_RANK: Record<AccessibilityState, number> = {
  safe: 0,
  unknown: 1,
  caution: 2,
  unsafe: 3,
};
const CONFIDENCE_RANK: Record<LegAccessibilityConfidence, number> = {
  high: 3,
  medium: 2,
  low: 1,
};

const WORST_STATE = (a: AccessibilityState, b: AccessibilityState): AccessibilityState =>
  STATE_RANK[a] >= STATE_RANK[b] ? a : b;

const MIN_CONFIDENCE = (
  a: LegAccessibilityConfidence,
  b: LegAccessibilityConfidence,
): LegAccessibilityConfidence => (CONFIDENCE_RANK[a] <= CONFIDENCE_RANK[b] ? a : b);

@Injectable()
export class RouteAccessibilityFusionService {
  /**
   * Converte sinais brutos em `Evidence[]` canônicas.
   * Função PURA — não faz I/O; segura para chamar dentro de `Promise.all`.
   */
  signalsToEvidences(signals: WalkLegSignals): Evidence[] {
    const ev: Evidence[] = [];

    if (!signals.walkCoordsOk) {
      ev.push({
        source: 'policy',
        kind: 'missing_geometry',
        severity: 'high',
        confidence: 'high',
        detail: 'Trecho a pé sem coordenadas válidas para análise.',
      });
    }

    if (signals.slopePercent !== null) {
      const slope = signals.slopePercent;
      if (slope > 8) {
        ev.push({
          source: 'elevation',
          kind: 'excessive_slope',
          severity: 'high',
          confidence: 'high',
          detail: `Inclinação ~${slope.toFixed(1)}% (acima de 8%).`,
          metadata: { slope },
        });
      } else if (slope > 5) {
        ev.push({
          source: 'elevation',
          kind: 'moderate_slope',
          severity: 'medium',
          confidence: 'medium',
          detail: `Inclinação ~${slope.toFixed(1)}% (entre 5% e 8%).`,
          metadata: { slope },
        });
      } else {
        ev.push({
          source: 'elevation',
          kind: 'slope_ok',
          severity: 'low',
          confidence: 'high',
          detail: `Inclinação ~${slope.toFixed(1)}% — dentro do limite.`,
          metadata: { positive: true, slope },
        });
      }
    } else if (signals.walkCoordsOk) {
      // sem dado de elevação não é "alarme", mas reduz confiança da fusão
      ev.push({
        source: 'elevation',
        kind: 'source_skipped',
        severity: 'low',
        confidence: 'low',
        detail: 'Sem dado de elevação para o trecho.',
      });
    }

    const op = signals.overpass;
    if (op) {
      if (op.ok === false) {
        ev.push({
          source: 'overpass',
          kind: 'source_skipped',
          severity: 'low',
          confidence: 'low',
          detail: `Overpass indisponível (${op.reason}).`,
          metadata: { reason: op.reason },
        });
      } else {
        let pushedAny = false;
        if (op.stepFeatureCount > 0) {
          ev.push({
            source: 'overpass',
            kind: 'stairs_or_steps',
            severity: 'high',
            confidence: 'high',
            detail: `${op.stepFeatureCount} elemento(s) de degrau/escada mapeados em OSM no corredor do trecho.`,
            metadata: { count: op.stepFeatureCount },
          });
          pushedAny = true;
        }
        if (op.roughSurfaceFeatureCount > 0) {
          ev.push({
            source: 'overpass',
            kind: 'rough_surface',
            severity: 'medium',
            confidence: 'medium',
            detail: `${op.roughSurfaceFeatureCount} via(s) com superfície irregular mapeada (OSM).`,
            metadata: { count: op.roughSurfaceFeatureCount },
          });
          pushedAny = true;
        }
        if (!pushedAny) {
          ev.push({
            source: 'overpass',
            kind: 'no_obstacles_mapped',
            severity: 'low',
            confidence: 'high',
            detail: 'OSM sem degraus ou superfície irregular mapeados no corredor do trecho.',
            metadata: { positive: true },
          });
        }
      }
    }

    const ors = signals.ors;
    if (ors) {
      if (ors.status === 'no_route') {
        ev.push({
          source: 'ors_wheelchair',
          kind: 'no_wheelchair_route',
          severity: 'medium',
          confidence: 'medium',
          detail:
            'OpenRouteService (perfil cadeira) não encontrou rota contínua entre os pontos do trecho.',
        });
      } else if (ors.status === 'ok') {
        const declared = signals.declaredWalkMeters;
        let pushedDetour = false;
        if (declared && declared > 0) {
          const ratio = ors.distanceMeters / declared;
          const extra = ors.distanceMeters - declared;
          if (ratio >= 1.45 && extra >= 50) {
            ev.push({
              source: 'ors_wheelchair',
              kind: 'wheelchair_detour',
              severity: 'low',
              confidence: 'high',
              detail: `Rota cadeira (~${Math.round(ors.distanceMeters)} m) excede a distância declarada (~${Math.round(declared)} m).`,
              metadata: { orsM: ors.distanceMeters, declaredM: declared, ratio },
            });
            pushedDetour = true;
          }
        }
        if (!pushedDetour) {
          ev.push({
            source: 'ors_wheelchair',
            kind: 'wheelchair_route_ok',
            severity: 'low',
            confidence: 'high',
            detail: 'OpenRouteService traçou rota acessível para cadeira sem desvio relevante.',
            metadata: { positive: true, distanceMeters: ors.distanceMeters },
          });
        }
      } else if (ors.status === 'skipped' && ors.reason !== 'no_key') {
        ev.push({
          source: 'ors_wheelchair',
          kind: 'source_skipped',
          severity: 'low',
          confidence: 'low',
          detail: `ORS wheelchair indisponível (${ors.reason}).`,
          metadata: { reason: ors.reason },
        });
      }
    }

    const gem = signals.gemini;
    if (gem) {
      if (gem.state === 'unsafe') {
        ev.push({
          source: 'gemini_vision',
          kind: 'image_obstacle',
          severity: 'medium',
          confidence: gem.confidence,
          detail:
            gem.detail ?? 'Análise visual sugere obstáculo na calçada deste trecho.',
        });
      } else if (gem.state === 'safe' && gem.confidence !== 'low') {
        // Visão "ok" só conta como evidência POSITIVA (não vira "safe" sozinha).
        ev.push({
          source: 'gemini_vision',
          kind: 'image_clear',
          severity: 'low',
          confidence: gem.confidence,
          detail: gem.detail ?? 'Imagens da calçada sem obstáculos aparentes.',
          metadata: { positive: true },
        });
      } else {
        ev.push({
          source: 'gemini_vision',
          kind: 'image_uncertain',
          severity: 'low',
          confidence: 'low',
          detail:
            gem.state === 'unknown'
              ? `Visão sem conclusão (${gem.reason}).`
              : 'Análise visual com baixa confiança — descartada como decisória.',
        });
      }
    }

    const otp = signals.otpWheelchair;
    if (otp?.wheelchair && otp.accessible === false) {
      ev.push({
        source: 'otp',
        kind: 'transit_not_wheelchair',
        severity: 'medium',
        confidence: 'medium',
        detail: 'OTP marcou leg como não acessível para cadeira de rodas.',
      });
    }

    return ev;
  }

  /**
   * Fusão por trecho. Função PURA.
   *
   * Regras:
   *  - Pior `severity` com `confidence` ≠ low define o `state` final (worst-wins).
   *  - Se só houver evidências `low confidence`, estado vira `unknown`.
   *  - Gemini "ok" sozinho NÃO eleva estado para `safe`; apenas reforça.
   *  - Score 0–100 = 100 menos soma das penalidades (severity × confidence).
   *  - `warning` é gerado pela fusão (ORS/Overpass/elevação podem disparar texto).
   */
  fuseWalkLeg(signals: WalkLegSignals): LegFusionResult {
    const evidences = this.signalsToEvidences(signals);

    // separa "positivas" (kind === image_clear) — não geram penalidade nem warning
    const negative = evidences.filter(
      (e) => e.metadata?.positive !== true && e.kind !== 'source_skipped',
    );
    const skipped = evidences.filter((e) => e.kind === 'source_skipped');

    let score = 100;
    for (const e of negative) {
      score -= PENALTY_TABLE[e.severity][e.confidence];
    }
    // cada source skipped tira pontinhos (incentiva ter dados completos)
    score -= Math.min(8, skipped.length * 2);
    score = Math.max(0, Math.min(100, Math.round(score)));

    let state: AccessibilityState = 'safe';
    let confidence: LegAccessibilityConfidence = 'high';

    const positives = evidences.filter((e) => e.metadata?.positive === true);
    const decisive = negative.filter((e) => e.confidence !== 'low');
    if (decisive.length === 0) {
      // ninguém com confiança suficiente: depende dos sinais positivos
      const decisivePositives = positives.filter((e) => e.confidence !== 'low');
      if (negative.length === 0 && decisivePositives.length >= 2) {
        state = 'safe';
        confidence = decisivePositives.length >= 3 ? 'high' : 'medium';
      } else if (negative.length === 0 && decisivePositives.length === 1) {
        state = 'safe';
        confidence = 'medium';
      } else {
        state = 'unknown';
        confidence = 'low';
      }
    } else {
      // worst-wins
      const worst = decisive.reduce((acc, e) =>
        // pior severidade vence; em empate, maior confiança vence
        // ordering: high > medium > low
        ['low', 'medium', 'high'].indexOf(e.severity) >
        ['low', 'medium', 'high'].indexOf(acc.severity)
          ? e
          : ['low', 'medium', 'high'].indexOf(e.severity) ===
                ['low', 'medium', 'high'].indexOf(acc.severity) &&
              CONFIDENCE_RANK[e.confidence] > CONFIDENCE_RANK[acc.confidence]
            ? e
            : acc,
      );
      if (worst.severity === 'high') state = 'unsafe';
      else if (worst.severity === 'medium') state = 'caution';
      else state = 'safe';

      // confiança da fusão = pior das confianças dos itens decisivos
      confidence = decisive.reduce<LegAccessibilityConfidence>(
        (acc, e) => MIN_CONFIDENCE(acc, e.confidence),
        'high',
      );
      if (skipped.length >= 2) confidence = MIN_CONFIDENCE(confidence, 'medium');
    }

    const alerts: string[] = [];
    for (const e of negative) {
      const text = this.evidenceToWarningText(e);
      if (text && !alerts.includes(text)) alerts.push(text);
    }

    let warning: string | null = null;
    if (state === 'unsafe' || state === 'caution') {
      warning = alerts[0] ?? this.defaultWarningFor(state);
    } else if (state === 'unknown') {
      warning = null;
    }

    const sourcesUsed = Array.from(new Set(evidences.map((e) => e.source)));

    return {
      state,
      confidence,
      score,
      warning,
      alerts,
      sourcesUsed,
      evidences,
    };
  }

  /**
   * Agrega legs walk numa rota inteira.
   * Função PURA — sem I/O.
   */
  fuseRoute(
    legResults: LegFusionResult[],
    options?: { minScoreAlone?: number },
  ): RouteFusionResult {
    const minScore = options?.minScoreAlone ?? ROUTES_ALONE_MIN_SCORE;

    if (legResults.length === 0) {
      return {
        score: 50,
        state: 'unknown',
        confidence: 'low',
        alone_eligible: false,
        companied_recommended_reason:
          'Sem trechos a pé analisados — análise insuficiente.',
        sourcesUsed: [],
        legResults: [],
        blockerCounts: { high: 0, medium: 0, low: 0 },
      };
    }

    let aggregateScore = 0;
    let totalUnknownPenalty = 0;
    let routeState: AccessibilityState = 'safe';
    let routeConfidence: LegAccessibilityConfidence = 'high';
    const sources = new Set<string>();
    const blockerCounts = { high: 0, medium: 0, low: 0 };
    let highConfirmed = 0;

    for (const leg of legResults) {
      aggregateScore += leg.score;
      if (leg.state === 'unknown') totalUnknownPenalty += 8;
      routeState = WORST_STATE(routeState, leg.state);
      routeConfidence = MIN_CONFIDENCE(routeConfidence, leg.confidence);
      for (const s of leg.sourcesUsed) sources.add(s);
      for (const e of leg.evidences) {
        if (e.metadata?.positive === true) continue;
        if (e.kind === 'source_skipped') continue;
        if (e.severity === 'high') {
          blockerCounts.high += 1;
          if (e.confidence !== 'low') highConfirmed += 1;
        } else if (e.severity === 'medium') blockerCounts.medium += 1;
        else if (e.severity === 'low') blockerCounts.low += 1;
      }
    }

    const score = Math.max(
      0,
      Math.min(
        100,
        Math.round(aggregateScore / legResults.length - totalUnknownPenalty),
      ),
    );

    // Política Sozinho (top-K vem de partitionRoutesByScore; aqui só sinalizamos elegibilidade):
    //   - score >= piso
    //   - sem bloqueador HIGH com confiança ≠ low (veto duro restrito)
    //   - rota inteira não pode ser `unknown` (dados realmente insuficientes)
    //   - se confidence final for "low" exigimos folga mínima de score (evita tudo Sozinho às cegas)
    const aloneEligible =
      score >= minScore &&
      highConfirmed === 0 &&
      routeState !== 'unknown' &&
      !(routeConfidence === 'low' && score < minScore + 10);

    let companiedReason: string | null = null;
    if (!aloneEligible) {
      if (highConfirmed > 0) {
        companiedReason =
          'Trecho com obstáculo grave confirmado em mais de uma fonte (ex.: degraus, inclinação >8%).';
      } else if (routeState === 'unknown') {
        companiedReason =
          'Dados insuficientes para confirmar acessibilidade com segurança.';
      } else if (score < minScore) {
        companiedReason =
          'Score de acessibilidade abaixo do mínimo para a aba Sozinho.';
      } else if (routeConfidence === 'low') {
        companiedReason =
          'Dados insuficientes para confirmar acessibilidade com segurança.';
      }
    }

    return {
      score,
      state: routeState,
      confidence: routeConfidence,
      alone_eligible: aloneEligible,
      companied_recommended_reason: companiedReason,
      sourcesUsed: Array.from(sources) as RouteFusionResult['sourcesUsed'],
      legResults,
      blockerCounts,
    };
  }

  /** Texto curto, PT-BR, derivado de um item de evidência. */
  private evidenceToWarningText(e: Evidence): string | null {
    switch (e.kind) {
      case 'missing_geometry':
        return 'Trecho a pé sem geometria suficiente para validar acessibilidade.';
      case 'excessive_slope':
        return e.detail ?? 'Trecho com inclinação acima de 8%.';
      case 'moderate_slope':
        return e.detail ?? 'Trecho com inclinação moderada (entre 5% e 8%).';
      case 'stairs_or_steps':
        return 'Próximo a escadas/degraus mapeados (OpenStreetMap). Prefira companhia ou outro trajeto se não puder usar degraus.';
      case 'rough_surface':
        return 'Trecho com calçada ou caminho de superfície irregular (OpenStreetMap). Avalie no local ou prefira companhia.';
      case 'no_wheelchair_route':
        return 'OpenRouteService (perfil cadeira) não encontrou rota contínua entre estes pontos. Prefira ir acompanhado ou confirme no local.';
      case 'wheelchair_detour':
        return e.detail ?? 'Possível desvio na rota acessível para cadeira.';
      case 'image_obstacle':
        return (
          e.detail ??
          'Possível obstáculo identificado nesse trecho — avalie se consegue passar ou prefira uma alternativa.'
        );
      case 'transit_not_wheelchair':
        return 'Leg de trânsito sem garantia de acessibilidade para cadeira (OTP).';
      default:
        return e.detail ?? null;
    }
  }

  private defaultWarningFor(state: AccessibilityState): string {
    if (state === 'unsafe') {
      return 'Trecho com obstáculo confirmado em mais de uma fonte — prefira companhia ou alternativa.';
    }
    return 'Trecho com sinais de baixa acessibilidade — siga com atenção ou prefira companhia.';
  }
}
