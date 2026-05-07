# Especialista de acessibilidade de trajetos — especificação para implementação

Este documento descreve **o problema atual**, **o comportamento desejado** e um **plano passo a passo** para refatorar o `mobility-api` de modo que a decisão de acessibilidade (principalmente **trechos a pé**) use **todas as fontes de dados em conjunto**, em **paralelo**, com **fusão explícita de evidências** — e não cadeias do tipo “OTP ou Google” ou “Gemini ou assume acessível” como única verdade.

**Público-alvo:** agente de código (ex.: Claude Opus) implementando no repositório `mobility-api`.

---

## 1. Contexto do produto

- O app **Mobility** chama `POST /routes/check` com origem, destino, tipo de transporte, filtros de horário, etc.
- A resposta inclui listas **`routes_alone`** e **`routes_companied`**: o usuário escolhe se viaja **sozinho** ou **acompanhado**.
- **Trechos a pé** são o que mais determinam acessibilidade real no chão (calçada, rampa, degrau, inclinação, obstáculos). Trânsito (ônibus/metrô) importa, mas a **perna walk** é prioridade para PCD / mobilidade reduzida.

### 1.1 Princípio de realismo + ranking (Sozinho / Acompanhado)

- Na cidade real, **quase nenhum trajeto é 100% “perfeito”** sob todas as fontes; o sistema deve ser transparente com **alertas** e **incertezas**.
- A aba **Sozinho** não deve exigir perfeição em cada perna; deve priorizar as alternativas com **maior score (ou classificação) composta de acessibilidade** após a fusão de evidências — isto é, as **N melhores** rotas entre as candidatas (ex.: top-K alinhado a `ROUTES_ALONE_MAX` e piso `ROUTES_ALONE_MIN_SCORE` em [`route-scoring.util.ts`](src/routes/utils/route-scoring.util.ts)).
- A aba **Acompanhado** cobre o restante, rotas com sinais piores ou mais incerteza, e recebe **explicações** (`alerts` / `companied_recommended_reason`) quando fizer sentido.
- **Vetos duros** (opcionais e configuráveis) reservam-se a casos **claramente inaceitáveis** (ex.: blocker `high` bem fundamentado); não substituem o ranking para o grosso das rotas.

---

## 2. Situação atual no código (o que está errado para o objetivo)

### 2.1 Roteamento “exclusivo” em alguns momentos

- Para obter **alternativas brutas** (`routeOptions`), o fluxo em `RoutesService.checkRoute` tende a **escolher uma fonte primária** (ex.: tentar OTP; se vazio, Google). Isso resolve **geometria do itinerário**, mas **não** satisfaz o requisito de “usar todos os dados para **classificar** acessibilidade”.
- **Desejado:** a fonte do **desenho** da rota pode continuar priorizada (OTP quando útil, senão Google), mas a **avaliação de acessibilidade** deve **sempre** agregar **todas** as fontes disponíveis para cada trecho a pé (e, quando aplicável, para trânsito).

### 2.2 Gemini e fallbacks permissivos

- Em falhas de imagem, timeout ou parse, o serviço Gemini historicamente cai em **`accessible: true`** ou equivalente.
- **Desejado:** ausência de evidência visual **não** deve ser tratada como “seguro”; deve gerar **incerteza** (`unknown` / `low confidence`) que **impacta** Sozinho/Acompanhado via motor de fusão, não um default otimista.

### 2.3 Partição Sozinho / Acompanhado

- Hoje há pontuação e filtros em `partitionRoutesByScore` e lógica em `RoutesService`.
- **Desejado:** **Sozinho** prioriza as rotas com **melhor score fusionado** entre as alternativas; o “conservadorismo” aparece como **piso** (mínimo de score, vetos para cauda claramente ruim), **não** como exigência de que **cada** trecho a pé seja perfeito.
- Critérios explícitos derivados do **painel de evidências fusionado** (ver seção 4), integrados num **único score composto explicável**, em vez de só penalidades dispersas sem narrativa.

### 2.4 OTP

- OTP está configurável via `OTP_URL`. O grafo pode ser **só OSM (rede viária)** até existir GTFS; isso muda o que OTP consegue planejar (trânsito vs só walk), mas **não** muda a regra: **dados OTP entram no painel** sempre que a requisição OTP for feita ou quando houver geometria/legs OTP mapeáveis.

---

## 3. Objetivo arquitetural (definição clara)

Introduzir um **módulo “Especialista de acessibilidade de trajeto”** (nome sugerido: `RouteAccessibilityFusionService` ou `WalkAccessibilityFusionService`) que:

1. **Recebe** um objeto canônico por **trecho** (stage), especialmente `mode === walk`, com **todas** as leituras brutas já coletadas.
2. **Normaliza** cada leitura em **evidências** tipadas (ver seção 4).
3. **Combina** evidências com regras **explícitas** (AND/OR, pesos, “worst wins” para risco).
4. **Emite** por trecho:
   - `accessibility_state`: ex. `safe` | `caution` | `unsafe` | `unknown`
   - `confidence`: `high` | `medium` | `low`
   - `warning` (e/ou `alerts[]`): textos para UI / API — **obrigatório** que avisos sobre trecho **acidentado**, irregular, íngreme, com bloqueio provável ou incerteza relevante venham da **classificação fusionada** do especialista (resultado de `fuseWalkLeg`), não apenas de uma única fonte.
   - `sources_used[]`: rastreabilidade
5. **Emite** por **rota** agregada:
   - **Score (ou rank) fusionado** de acessibilidade: número e/ou ordem usada para decidir quem entra em **`routes_alone`** primeiro.
   - `alone_eligible`: derivado do **score + limiares** (e, se política assim definir, **vetos duros** só para casos extremos — ex.: blocker `high` confirmado).
   - `companied_recommended_reason` quando a rota cai em Acompanhado ou tem score abaixo do piso de Sozinho.
6. **Alimenta** `partitionRoutesByScore` (ou equivalente) para que **`routes_alone`** receba as **melhores** rotas por **score fusionado** (top-K), **sem** assumir que todas são 100% acessíveis; alertas continuam visíveis na resposta.

**Importante:** o especialista **não substitui** as APIs; ele **interpreta** o que elas devolveram. Nenhuma API é “a verdade única”.

---

## 4. Modelo de dados: `Evidence` (contrato interno)

Definir um tipo TypeScript compartilhado, ex. em `src/routes/contracts/route-accessibility-fusion.contract.ts`:

```text
Evidence {
  source: 'otp' | 'google' | 'ors_wheelchair' | 'overpass' | 'elevation' | 'here' | 'gemini_vision' | 'structural_engine' | ...
  kind: string           // ex.: 'stairs', 'steep_slope', 'no_wheelchair_route', 'rough_surface', 'image_uncertain'
  severity: 'low' | 'medium' | 'high'
  confidence: 'high' | 'medium' | 'low'
  detail?: string        // human-readable, PT-BR
  metadata?: Record<string, unknown>
}
```

**Regras sugeridas:**

- **Conflito:** para **risco físico**, prevalece a **pior** `severity` com `confidence` não baixa; se só houver `low confidence`, marcar **unknown** em vez de `safe`.
- **Gemini:** nunca retorna “safe” sozinho se `confidence` da visão for baixa; no máximo reforça ou contradiz evidências estruturais.
- **ORS / OTP wheelchair / Overpass:** evidências estruturais com `confidence` high/medium **pesam forte** no **score composto** (e podem acionar **vetos** se a política definir limiares claros).

### 4.1 Avisos em trechos walk: fusão primeiro, Gemini como reforço

- Trajetos com trechos a pé **acidentados** (superfície irregular, degraus mapeados, inclinação forte, desvio grande no ORS cadeira, `slopeExceeded` OTP, etc.) devem receber **`warning`** no `stage` quando a **fusão** assim classificar — **mesmo sem** Street View ou **sem** análise visual.
- **Gemini** (fotos) é **uma entrada** no painel de evidências: pode **ajustar o texto** do aviso ou acrescentar detalhe quando a imagem for utilizável, mas **não** é a única fonte legítima de `warning`. Se Gemini falhar, faltar imagem ou a visão for incerta, o trecho ainda pode (e deve) ter `warning` derivado de **ORS, Overpass, elevação, OTP, HERE**, etc., conforme o resultado do especialista.
- Evitar o padrão antigo “só há aviso se o Gemini viu a calçada”: a **classificação do agente nas etapas walk** é quem consolida o risco e preenche `warning` / flags (`slope_warning`, etc.) de forma coerente com todas as fontes.

---

## 5. Paralelismo e orçamento de tempo (latência)

Hoje já existe `Deadline` / `deadline.race` em `enrichSingleRouteOption`. **Estender** esse padrão:

1. **Fase A (paralela, por trecho walk):**  
   Overpass (já usado no motor estrutural), ORS wheelchair (se chave presente), elevação entre pontos do trecho, **e** (se política permitir) Gemini **em paralelo** — não sequencial “só se structural falhar”.

2. **Fase B (fusão):**  
   Função pura e rápida: `fuseWalkLeg(evidences[]) -> LegFusionResult` — roda na CPU, sem I/O.

3. **Fase C (agregação de rota):**  
   Agregar evidências dos legs (walk e, quando aplicável, trânsito) num **score final de acessibilidade por rota** (e metadados de confiança). A partição ordena por esse score e preenche **Sozinho** com **top-K** (como hoje com `ROUTES_ALONE_MAX`), respeitando **piso** configurável — **não** um `every(leg)` rígido de “todos safe”. Trânsito segue regras existentes para `wheelchairAccessible` OTP, etc.

4. **Política de timeout:**  
   Se uma fonte estourar o orçamento, registrar evidência `source: 'timeout', kind: 'source_skipped', confidence: low` em vez de ignorar silenciosamente.

**Meta:** paralelizar **dentro** do orçamento global (~5s server-side já existente), não adicionar novas fases sequenciais desnecessárias.

---

## 6. Onde encaixar no código (mobility-api)

| Área atual | Mudança esperada |
|------------|------------------|
| `src/routes/routes.service.ts` — `enrichSingleRouteOption` | Após coletar dados brutos de cada fonte, chamar **fusão** por trecho; parar de usar fallback Gemini como `accessible: true` silencioso. |
| `src/routes/walk-accessibility-engine.service.ts` | Continua produzindo **parte** das evidências estruturais; saída deve mapear para `Evidence[]`, não só `LegAccessibilityReport` solto. |
| `src/routes/gemini.service.ts` | Retornar sempre `{ state, confidence, warning }` compatível com fusão; erros → evidência `unknown`, não “acessível”. |
| `src/routes/otp.service.ts` | Expor nos stages dados brutos suficientes (ex.: `slopeExceeded`, flags wheelchair) já mapeados; alimentar fusão. |
| `src/routes/utils/route-scoring.util.ts` | Partição Sozinho/Acompanhado deve usar o **score fusionado** como eixo principal para ranking e top-K em Sozinho; **vetos** / `alone_eligible` complementam (ex.: excluir cauda inaceitável). |
| Novo arquivo | `route-accessibility-fusion.service.ts` (+ testes unitários extensivos). |

---

## 7. Passo a passo de implementação (ordem recomendada)

### Fase 0 — Documentação e contratos

1. Congelar o tipo `Evidence` e `LegFusionResult` / `RouteFusionResult` em `contracts/`.
2. Documentar matriz **fonte × o que extrai** (tabela no código ou comentário no serviço de fusão).

### Fase 1 — Coleta paralela por trecho walk

3. Refatorar `enrichSingleRouteOption` para **acumular** resultados em um objeto `WalkLegSignals` antes de setar `stage.accessible` diretamente.
4. Garantir que **ORS**, **Overpass/structural**, **elevação**, **Gemini** (se habilitado) disparem com `Promise.all` + `deadline.race` por fonte, registrando skips.

### Fase 2 — Motor de fusão

5. Implementar `fuseWalkLeg(signals): LegFusionResult` **função pura**, com testes:
   - só fontes vazias / timeouts → forte **penalidade** no score / `unknown` no trecho (empurra a rota para baixo no ranking e tende a **Acompanhado**, sem necessariamente “zerar” todas as rotas).
   - escadas OSM high + Gemini diz ok → **unsafe** ou peso forte negativo no score (pior evidência ganha).
   - inclinação > limiar + confirmação elevação → unsafe, caution ou penalidade no score conforme política.

6. Implementar `fuseRoute(legs): RouteFusionResult` produzindo **score composto** e flags auxiliares; **Sozinho** = rotas **acima do piso** de score / **sem veto duro** (política configurável), **não** “todos os walks safe + threshold” como regra absoluta.

### Fase 3 — Integração com partição

7. Substituir ou complementar `partitionRoutesByScore` para ordenar e filtrar principalmente pelo **score fusionado** (top-K para `routes_alone`); `alone_eligible` / vetos atuam como **complemento** (ex.: excluir outliers perigosos), não como substituto do ranking.
8. Manter `routes_alone` / `routes_companied` disjuntos; Acompanhado recebe explicação agregada (`alerts`).

### Fase 4 — Observabilidade

9. Log estruturado por requestId: fontes OK, timeouts, decisão final Sozinho.
10. (Opcional) campo `fusion_debug` na resposta só em `NODE_ENV !== production` para depuração.

### Fase 5 — Hardening

11. Revisar todos os `return { accessible: true }` em falha (Gemini, etc.).
12. Testes e2e com mocks fixos para OTP + ORS + Overpass sem rede.

---

## 8. Critérios de aceite (checklist)

- [ ] **Sozinho** contém as **melhores** rotas por **score de acessibilidade** disponível na resposta — **não** se exige que sejam rotas “perfeitas”; alertas e ressalvas podem coexistir com entrada em Sozinho quando o score ainda é o mais alto entre as opções.
- [ ] Nenhuma rota sobe no ranking de **Sozinho** só porque **uma** fonte isolada disse “ok” sem o painel fusionado refletir isso (multi-fonte obrigatória na composição do score).
- [ ] Falha/timeout de fonte relevante **penaliza** o score e/ou a confiança agregada (pode empurrar para **Acompanhado** ou para posições piores no ranking); evitar “ganhar” Sozinho só com dados incompletos sem penalização explícita.
- [ ] Gemini é **uma evidência entre várias**, nunca o único gate.
- [ ] Trechos walk **acidentados** ou com risco estrutural exibem **`warning`** (ou equivalente) vindos da **fusão** / classificação do especialista; **não** dependem exclusivamente de Gemini ou de foto.
- [ ] OTP contribui com evidências sempre que usado na construção da rota ou quando legs OTP estiverem disponíveis.
- [ ] Coleta das fontes é **predominantemente paralela** dentro do orçamento existente.
- [ ] Resposta da API continua compatível com o app atual (`routes_alone`, `routes_companied`, estrutura de `stages`), apenas com alertas/decisões mais consistentes e ranking alinhado ao score fusionado.

---

## 9. Notas para o implementador

- **GTFS:** quando o grafo OTP ganhar GTFS, as evidências de trânsito (ex.: `wheelchairAccessible`) entram na mesma fusão no nível do leg de ônibus/metrô; walks continuam sendo o foco principal do produto.
- **Não expandir escopo** para refatorar todo o app mobile nesta tarefa; foco no `mobility-api`.
- O **score composto** é o **eixo principal** para ordenar Sozinho vs demais opções; ele deve ser **explicável** (derivado de `Evidence[]` e pesos documentados), não um número opaco — “sem score mágico” significa **sem caixa-preta**, não “sem score”.

---

## 10. Referências internas úteis

- `src/routes/routes.service.ts` — `checkRoute`, `enrichSingleRouteOption`, deadline
- `src/routes/walk-accessibility-engine.service.ts` — OSM + ORS
- `src/routes/gemini.service.ts` — visão
- `src/routes/otp.service.ts` — planejamento OTP
- `src/routes/utils/route-scoring.util.ts` — partição atual
- `docs/ACCESSIBILITY_POLICY.md` — alinhamento de produto

---

*Documento gerado para orientar implementação do “especialista” de fusão de acessibilidade. Atualize este arquivo se a política de produto mudar.*
