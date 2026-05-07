# Especificação: agente LLM (Gemini) para partição de rotas — sozinho × acompanhado

**Público-alvo:** agente de código (ex.: Claude Opus) implementando no repositório `mobility-api`.

**Objetivo:** introduzir um **agente orientado a LLM** (API **Google Gemini**) que, com base em **todas** as evidências de acessibilidade já produzidas pelo pipeline atual (OTP, Google, visão, OSM, fusão existente, etc.), calcula um **score global de acessibilidade (0–100)** por rota ou por conjunto de opções e **classifica** o que deve aparecer na aba **Sozinho** versus **Acompanhado**, sem tratar uma única fonte como verdade absoluta.

Este documento **não** substitui `ACCESSIBILITY_ROUTE_SPECIALIST.md`; ele **acrescenta** uma camada de **decisão e ranking** mediada por LLM, alinhada a **personas** e a boas práticas de **mobilidade urbana** e **acessibilidade**.

---

## 1. Contexto e problema

- O produto precisa separar rotas em duas experiências: **Sozinho** (usuário consegue encarar o trajeto com autonomia razoável) e **Acompanhado** (há riscos, incertezas ou barreiras que recomendam apoio).
- Hoje já existem sinais agregados (fusão de evidências, flags OTP, Gemini visão, etc.). Falta uma camada que:
  - **Combine explicitamente todas as fontes** num juízo único (score + explicação estruturada).
  - **Respeite personas** distintas (baixa visão, cadeirante, mobilidade reduzida).
  - **Destaque trechos acidentados** com **warnings** claros, sem depender de uma única fonte.

---

## 2. Personas (obrigatório considerar no prompt e na lógica)

O agente deve sempre raciocinar como se estivesse avaliando o trajeto para **três personas**, com pesos explícitos no desenho do prompt (e, se útil, três sub-scores ou justificativas por persona):

| ID | Persona | Foco principal na avaliação |
|----|---------|-----------------------------|
| `low_vision` | **Visão baixa** | Sinalização tátil/visual, contraste, continuidade de piso previsível, cruzeiros, obstáculos baixos, informação de paradas e transbordos, consistência de nomes/instruções. |
| `wheelchair` | **Cadeirante** | Rampas, desníveis, largura livre de calçada, inclinações, superfície, obstáculos fixos, acessibilidade declarada em transporte (quando houver), distâncias de transferência. |
| `reduced_mobility` | **Mobilidade reduzida** | Distâncias a pé, pausas, superfícies irregulares, escadas vs alternativas, fadiga, trechos com alta demanda motora, segurança em cruzamentos. |

**Regra:** o score **0–100** e a decisão **Sozinho vs Acompanhado** devem ser coerentes com **a persona do usuário da requisição** (ver seção 6). Quando a API não souber a persona, documentar comportamento padrão (ex.: score conservador ou retorno exigindo persona).

---

## 3. Princípios obrigatórios

1. **Fusão multi-fonte:** o LLM **nunca** deve decidir com base em uma única fonte (ex.: só Gemini, só OTP, só Google). O payload enviado ao modelo deve incluir **todas** as evidências relevantes já calculadas pelo backend (painel unificado). Se uma fonte faltar, isso deve constar como incerteza, não como “tudo acessível”.
2. **Especialista em mobilidade urbana:** o system instruction deve posicionar o modelo como especialista em **transporte coletivo, infraestrutura peatonal e acessibilidade** (normas e prática brasileira quando aplicável, sem inventar norma específica se não estiver nos dados).
3. **Warnings em trechos acidentados:** qualquer trecho com elevada incerteza, inclinação, superfície ruim, possível bloqueio ou conflito entre fontes deve gerar **warnings** textuais objetivos (PT-BR), vinculados a stage/leg quando possível.
4. **Transparência:** a resposta deve ser **estruturada** (JSON schema contratado pela API) com: score, decisão de aba, lista de warnings, breve rationale, e opcionalmente sub-scores ou notas por persona.
5. **Custo e latência:** preferir modelo **Gemini** já alinhado ao projeto (`GEMINI_API_KEY`); permitir fallback configurável (similar ao `GeminiService` existente).

---

## 4. Entrada esperada do agente (contrato sugerido)

Definir um DTO interno (ex.: `AccessibilityAgentInput`) montado pelo `RoutesService` (ou serviço dedicado) **antes** da chamada ao LLM, contendo no mínimo:

- `requestId`, `userPersona`: `low_vision` | `wheelchair` | `reduced_mobility`
- Para **cada opção de rota** (ou para o conjunto a ranquear):
  - Identificador estável da opção
  - Lista de **legs/stages** com modo, distância, duração
  - **Painel de evidências** já fusionadas: o mesmo tipo de estrutura que a fusão atual expõe (ex.: sinais OTP, Google, Gemini fusion, slope, flags de bloqueio, confiança por fonte)
  - Texto ou bullets **resumindo conflitos** entre fontes (se o código já detectar conflito, incluir; senão o LLM infere a partir do painel)
- Metadados: região/cidade se útil, `wheelchair` routing flag, idioma `pt-BR`

**Proibição:** enviar ao LLM apenas uma string genérica “rota X” sem o painel de evidências.

---

## 5. Saída esperada do agente (contrato sugerido)

Resposta JSON (validada com class-validator ou Zod no Nest), por exemplo:

```json
{
  "schemaVersion": 1,
  "routes": [
    {
      "routeId": "string",
      "accessibilityScore": 78,
      "tab": "alone",
      "confidence": "medium",
      "warnings": [
        { "stageIndex": 2, "severity": "medium", "message": "..." }
      ],
      "rationale": "Breve explicação em PT-BR, citando combinação de fontes.",
      "personaNotes": {
        "low_vision": "…",
        "wheelchair": "…",
        "reduced_mobility": "…"
      }
    }
  ],
  "partitionSummary": "Como as opções foram separadas entre sozinho e acompanhado."
}
```

### Regras de partição (negócio)

- **`tab: "alone"`:** rotas com score **acima de um limiar** configurável (ex.: `ACCESSIBILITY_AGENT_ALONE_MIN_SCORE`, default sugerido **70**) **e** sem warnings de severidade `high` não mitigados (definir no código).
- **`tab: "accompanied"`:** demais rotas ordenadas por score decrescente (ou por política do produto).
- Empates: priorizar menor incerteza agregada, menor número de warnings `high`, menor distância a pé se scores próximos.

O LLM **sugere** score, warnings e rationale; o backend **pode** aplicar pós-processamento determinístico (clamp 0–100, forçar `accompanied` se houver evidência forte de inacessibilidade vinda da fusão, etc.) para segurança.

---

## 6. Integração técnica (instruções ao implementador)

1. **Novo serviço** `AccessibilityLlmAgentService` (nome ajustável) em `src/routes/` ou `src/accessibility/`:
   - Monta `AccessibilityAgentInput` a partir dos dados já disponíveis após a fusão atual.
   - Chama Gemini (`generateContent`) com **system instruction** forte (especialista + personas + regra multi-fonte).
   - Faz parse estrito do JSON; em falha, retorna erro controlado ou fallback documentado (ex.: partição só por score heurístico sem LLM).
2. **Variáveis de ambiente sugeridas:**
   - `GEMINI_API_KEY` (já existe)
   - `ACCESSIBILITY_AGENT_MODEL` (default: alinhar ao projeto, ex. `gemini-2.5-flash` ou o mesmo padrão do `GeminiService`)
   - `ACCESSIBILITY_AGENT_ENABLED` (`true`/`false`)
   - `ACCESSIBILITY_AGENT_ALONE_MIN_SCORE` (número 0–100)
3. **Encaixe no fluxo HTTP:** após `checkRoute` (ou equivalente) ter as opções enriquecidas e fusionadas, chamar o agente para **ranquear e rotular** `alone` / `accompanied` antes da resposta ao cliente.
4. **Observabilidade:** logs estruturados com `requestId`, modelo usado, latência, tamanho do payload, e resultado da partição (sem logar base64 de imagens).
5. **Testes:** unitários com payloads fixos (mock do fetch Gemini); teste de que **entrada com uma única fonte preenchida** ainda envia o painel completo e que o prompt exige cautela.

---

## 7. System instruction (trecho mínimo a incluir no código)

O implementador deve materializar algo equivalente a:

- Você é um **especialista em mobilidade urbana e acessibilidade** (calçadas, transporte coletivo, deslocamento de pessoas com deficiência e mobilidade reduzida).
- Você recebe **dados agregados de várias fontes**; **não** presuma que uma fonte prevalece sobre outra; **integre** e declare incertezas.
- Você deve considerar as **três personas** (visão baixa, cadeirante, mobilidade reduzida) e **priorizar** a persona do usuário quando fornecida.
- Você deve atribuir um **score de 0 a 100** e **warnings** para trechos problemáticos.
- Resposta **somente** no JSON acordado, sem markdown.

(Ajustar tom e tamanho para limites de token.)

---

## 8. Fora de escopo (para não inflar o PR)

- Treinar ou hospedar modelo próprio.
- Substituir a fusão determinística atual; o agente **complementa** a decisão de produto (abas), não apaga evidências.
- Garantir conformidade legal com ECA/lei específica sem texto normativo nos dados de entrada.

---

## 9. Critérios de aceite

- Com persona e painel completos, a API retorna rotas **etiquetadas** para abas **Sozinho** / **Acompanhado** com **score 0–100** e **warnings** onde houver trechos acidentados ou incertos.
- Com `ACCESSIBILITY_AGENT_ENABLED=false`, o sistema mantém comportamento anterior (sem regressão).
- Documentar no `README.md` (seção integrações) as novas variáveis de ambiente.

---

## 10. Referências no repositório

- Fusão e evidências: `ACCESSIBILITY_ROUTE_SPECIALIST.md`, `src/routes/route-accessibility-fusion.service.ts`, contratos em `src/routes/contracts/`.
- Gemini existente: `src/routes/gemini.service.ts`.
- Personas de usuário no domínio: entidades/DTOs em `src/users/` (alinhamento com `disability_type` / perfil).

**Fim da especificação.**
