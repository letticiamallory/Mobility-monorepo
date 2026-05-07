# Política de acessibilidade — Mobility API (Fase 0)

Este documento define **regras de produto** estáveis para classificação de trajetos. A implementação evolui nas fases seguintes (motor estruturado, OSM, filas); aqui ficam os critérios que o código e os testes devem respeitar.

## Perfis de busca (`search_profile`)

| Valor | Significado |
|--------|-------------|
| `alone` | Usuário pretende percorrer **sem acompanhante** — só deve receber rotas que atendam critérios **Sozinho** (aba correspondente no app). |
| `companied` | Aceita ou prefere **acompanhamento** — inclui trajetos com trechos mais exigentes ou dados incompletos (aba **Acompanhado**). |

Uma mesma resposta da API pode conter **duas listas**: `routes_alone` e `routes_companied`, cada rota carregando `search_profile` coerente com a lista.

## Definição: **Sozinho** (rotas mais acessíveis disponíveis)

Sozinho é o **subconjunto mais acessível** entre as alternativas devolvidas para aquele par origem-destino — **não** é promessa de “100 % acessível”. A UI deve comunicar isso (“informação orientativa, confirme no local”).

Uma rota qualifica para **Sozinho** quando **todas** as condições abaixo são verdadeiras:

1. A rota não está marcada como globalmente inacessível (`accessible !== false`).
2. Não há alerta global de inclinação na rota (`slope_warning !== true`).
3. Nenhum estágio (walk ou transit) tem bloqueador estruturado de severidade **`high`** em `accessibility_report.blockers` (ex.: `stairs_or_steps`, `excessive_slope`, `missing_geometry`).
4. **Cada trecho a pé** (`mode` em `walk`, `walking`, `foot`) tem **geometria utilizável** (`walkSegmentCoordsOk`).
5. `accessibility_score` da rota ≥ **`ROUTES_ALONE_MIN_SCORE`** (env, padrão `65`).

Trechos que **não** são caminhada (ônibus, metrô, etc.) só excluem a rota de Sozinho via bloqueadores `high` (ex.: `transit_not_wheelchair` é `medium` — entra no score, **não** elimina sozinho por si só).

## Definição: **Acompanhado**

Qualquer rota que **não** satisfaz a definição de Sozinho vai para o conjunto **Acompanhado**, incluindo:

- Bloqueadores `high` em qualquer estágio (degraus mapeados, inclinação confirmada, sem geometria, etc.).
- Score abaixo do piso (acumula penalidades por bloqueadores `medium`/`low`, warnings textuais, slope, caminhada longa).
- Trechos a pé com `accessible === false`, `slope_warning === true` ou texto de warning preenchido.

## Disjunção e ordenação

- `routes_alone` ∩ `routes_companied` é sempre **vazio** após `partitionRoutesByScore`.
- Em ambas as listas, ordenação primária: `accessibility_score` desc; desempate por `total_duration` asc.
- Limites: `ROUTES_ALONE_MAX` (padrão 3) e `ROUTES_COMPANIED_MAX` (padrão 3).

## Níveis de severidade (para o contrato `LegAccessibilityReport`, fases futuras)

Usados quando o **motor estruturado** (OSM, elevação, ORS, etc.) produzir `blockers` explícitos:

| Severidade | Uso |
|------------|-----|
| `low` | Informação ou incômodo leve; pode não impedir Sozinho se política permitir. |
| `medium` | Risco ou incerteza moderada; em geral desloca para Acompanhado ou exige `confidence` alto em outras fontes. |
| `high` | Bloqueador claro (ex.: escadas, declividade excessiva confirmada); **nunca** Sozinho. |

## Confiança (`confidence` em relatórios por trecho)

| Valor | Significado |
|--------|-------------|
| `high` | Múltiplas fontes alinhadas ou dado explícito forte (ex.: tag OSM inequívoca). |
| `medium` | Uma fonte estruturada ou amostra parcial. |
| `low` | Dado ausente, apenas heurística, ou só visão/LLM sem suporte estruturado — **não** base para Sozinho sem política explícita futura. |

**Regra alinhada ao produto atual:** Sozinho exige evidência suficiente nos trechos a pé; trechos sem coords válidas já violam a regra de Sozinho (ver acima).

## Fase 1 — motor estruturado (implementado)

Por trecho a pé com coordenadas válidas, a API monta `accessibility_report` (ver contrato TypeScript) usando:

- **Inclinação** entre extremos do trecho (API de elevação já existente); acima de 8% permanece bloqueador para Sozinho como antes.
- **OpenStreetMap** via Overpass: elementos `highway=steps` / `stairway` no retângulo do trecho; se encontrados, o trecho é marcado **inacessível** com aviso (antes do Gemini).
- **OpenRouteService** perfil `wheelchair` (opcional): se `ORS_API_KEY` estiver definida e a rota existir, a fonte `ors_wheelchair` entra em `sources` (sinal positivo; ausência de chave ou erro não bloqueia Sozinho sozinha).

Desligar todo o motor estrutural: variável de ambiente `DISABLE_STRUCTURAL_ACCESSIBILITY=1`.

## Fase 2 — OTP acessível + ORS como gate

### OpenTripPlanner

- O cliente chama OTP com **`wheelchair=true`** quando a política abaixo indica (não apenas pela aba “Sozinho”).
- Variável **`OTP_WHEELCHAIR_ROUTING`** no backend:
  - **`auto`** (padrão): `wheelchair=true` se o usuário tem `disability_type` **wheelchair** ou **reduced_mobility**.
  - **`always`**: sempre `wheelchair=true`.
  - **`never`**: sempre `wheelchair=false`.
  - **`alone`** ou **`legacy`**: apenas quando a busca vem com `accompanied=alone` (comportamento antigo).
- Configuração do **servidor** OTP (OTP 2): ver `docs/OTP_WHEELCHAIR_SERVER.md`.

### OpenRouteService (ORS)

- Com **`ORS_API_KEY`** definida, cada trecho a pé exige uma rota no perfil **wheelchair** entre os mesmos extremos.
- Se a API responder **sem rota**, o relatório inclui bloqueador **`ors_no_wheelchair_route`** (severidade média), confiança **`low`**, aviso no estágio e a rota **não** entra na lista “Sozinho” (mesmo critério explícito em `isRouteSuitableForAlone`).
- Falha de rede/erro HTTP: apenas `sources` contém `ors_error`, **sem** bloqueador (não penalizar por indisponibilidade).

## Fase 3 — superfície OSM, desvio ORS e trânsito OTP

### OpenStreetMap (Overpass)

- Na mesma consulta aos degraus do trecho, o motor considera vias `footway` / `path` / `pedestrian` com `surface` irregular (ex.: `gravel`, `grass`, `dirt`, `sand`, `unpaved`, …).
- Se existir pelo menos uma ocorrência no corredor: bloqueador **`rough_surface`** (severidade **média**), fonte `overpass_rough_surface`, aviso no estágio a pé e a rota **não** entra em **Sozinho** (bloqueadores médios/altos em qualquer estágio).

### Heurística de desvio (ORS)

- Com rota wheelchair **válida** do ORS e distância declarada no trecho (texto parseado para metros), se a distância ORS for muito maior que a declarada, o relatório inclui **`ors_wheelchair_detour`** (severidade **baixa**) e `sources` pode incluir `ors_detour`.
- **Não** impede **Sozinho** sozinha (severidade baixa); serve para telemetria/UI avançada.
- Variáveis opcionais:
  - **`ORS_DETOUR_RATIO`** (padrão `1.45`): fator mínimo entre distância ORS e distância declarada.
  - **`ORS_DETOUR_MIN_EXTRA_M`** (padrão `50`): metros a mais mínimos além do declarado.
  - **`ORS_DETOUR_DISABLED`**: `1` / `true` / `yes` desliga a heurística.

### OpenTripPlanner (trânsito)

- Quando a requisição OTP foi feita com **`wheelchair=true`** e um perna **não-WALK** traz `wheelchairAccessible === false` no JSON do OTP, o estágio recebe `accessibility_report` com **`transit_not_wheelchair`** (severidade **média**). A rota **não** qualifica para **Sozinho** (mesma regra global de bloqueadores médios/altos).
- Se o campo não existir ou for `true`, nada é inferido (evita falsos positivos).

## Score 0–100 (`accessibility_score`)

A pontuação é calculada por `computeAccessibilityScore` em `src/routes/utils/route-scoring.util.ts`. Fórmula resumida:

```
score = 100
- 25  se route.accessible === false
- 20  se route.slope_warning === true
por estágio walk:
  - 22 se accessible === false
  - 16 se slope_warning === true
  - 14 se warning não vazio
por bloqueador estruturado em qualquer estágio:
  - high   → -25
  - medium → -12
  - low    → -3
+ até 5 (uma pequena bonificação por fontes positivas confirmadas: ors_wheelchair, otp_wheelchair_flag, overpass_steps, elevation_slope)
- até 15 (penalidade leve por minutos totais de caminhada: 1 ponto a cada 4 min)
clamp 0..100 (arredondado)
```

| Sinal | Severidade | Sozinho? |
|--------|------------|----------|
| `stairs_or_steps`, `excessive_slope`, `missing_geometry` | high | Não |
| `rough_surface`, `transit_not_wheelchair`, `ors_no_wheelchair_route` | medium | Depende do score |
| `ors_wheelchair_detour` | low | Sim, se score ≥ piso |
| `warning` textual em walk | — | Não (deduz score, baixa para Acompanhado) |
| `accessible === false` em walk/route | — | Não |
| `slope_warning === true` em route | — | Não |

## SLA — orçamento de tempo

- **Cliente**: hard cap 15 s no `searchRoutes` via `AbortController` + `SearchRoutesTimeoutError`.
- **Servidor**: deadline global em `checkRoute` (`ROUTES_CHECK_DEADLINE_MS`, padrão 13 000 ms) com `Deadline` cooperativo (`utils/deadline.util.ts`):
  - cada chamada a Gemini, Overpass, ORS, Wheelmap, Foursquare, Weather, Uber e elevação tem `perCallMs` próprio e fallback seguro;
  - walks "quentes" (com bloqueador médio/alto, slope ou warning) recebem **prioridade** na análise visual Gemini;
  - se o orçamento estourar, a resposta inclui `degraded: true` e `degraded_reason: 'time_budget'` mantendo as rotas já enriquecidas.

## Observabilidade

Requisições `POST /routes/check` registam tempos por fase (geocoding, obtenção de rotas, enriquecimento, partição) com `requestId` correlacionável nos logs (`RouteCheckTelemetry`). Marcas adicionais para Fase 4: `enrich_done.deadline_remaining_ms`, `degraded`.

## Responsabilidade e limites

As informações são **orientativas**. Provedores (Google, OTP, OSM, modelos de visão) podem estar incompletos ou desatualizados. Mensagens ao usuário final devem manter esse caráter.
