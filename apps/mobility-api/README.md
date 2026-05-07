# Mobility API

API REST em **NestJS** que serve o app **Mobility**: rotas urbanas com foco em **acessibilidade**, integração com mapas e IA para análise de trechos a pé, cadastro de usuários com tipo de deficiência, lugares, linhas/estações e notificações.

---

## Sumário

- [Arquitetura](#arquitetura)
- [Stack](#stack)
- [Requisitos](#requisitos)
- [Instalação rápida](#instalação-rápida)
- [Variáveis de ambiente](#variáveis-de-ambiente)
- [Banco de dados e migrações](#banco-de-dados-e-migrações)
- [Scripts npm](#scripts-npm)
- [Módulos e rotas HTTP](#módulos-e-rotas-http)
- [Contrato `POST /routes/check`](#contrato-post-routescheck)
- [Testes](#testes)
- [Deploy e produção](#deploy-e-produção)
- [Segurança](#segurança)
- [Licença](#licença)

---

## Arquitetura

- **Framework:** NestJS 11, validação global (`ValidationPipe`: whitelist + transform).
- **Persistência:** TypeORM + **PostgreSQL** (`synchronize: false` — schema via **migrations**).
- **Auth:** JWT (`JWT_SECRET`), login, Google, verificação de e-mail e recuperação de senha (Resend quando configurado).
- **Domínios:** usuários, lugares (`places`), histórico de rotas, linhas (`lines`), estações (`stations`), notificações FCM (Firebase Admin opcional), Uber (estimativa/deeplink), cache de fotos, etc.

```
mobility-api/
├── src/
│   ├── auth/              # login, JWT, Google, forgot/reset password, verify email
│   ├── users/
│   ├── places/
│   ├── routes/            # checkRoute, Google Directions, Gemini, OTP, elev/clima
│   ├── lines/
│   ├── stations/
│   ├── notifications/
│   ├── elevation/, weather/, accessibility/, here/, foursquare/, uber/
│   ├── cache/
│   ├── migrations/        # TypeORM migrations (*.ts)
│   ├── tests/             # Suites por persona, fluxo, contrato, bugs (Jest)
│   ├── app.module.ts
│   └── main.ts
├── migrations/            # SQL auxiliar (ex.: accompanied em users/routes)
├── test/                  # E2E Jest (ex.: app.e2e-spec.ts)
├── jest.config.ts
└── package.json
```

---

## Stack

| Camada | Tecnologia |
|--------|------------|
| Runtime | Node.js 18+ |
| API | NestJS, class-validator / class-transformer |
| ORM | TypeORM |
| BD | PostgreSQL |
| Rotas / mapas | Google Directions, Street View (via serviços em `routes/`) |
| IA | Gemini (análise de imagens de trechos) |
| E-mail | Resend (`RESEND_API_KEY`) |
| Push | Firebase Admin (opcional) |
| Outros | HERE, ORS, OpenWeather, Foursquare, Wheelmap, Nominatim, OTP (`OTP_URL`, opcionalmente `OTP_URL_MONTES_CLAROS` / `OTP_URL_BRASILIA` / `OTP_URL_SAO_PAULO`) |

---

## Requisitos

- **Node.js** 18+
- **PostgreSQL** acessível (local, Docker ou hospedado)
- Chaves das APIs externas conforme funcionalidades desejadas (rotas completas exigem Google + Gemini, etc.)

---

## Instalação rápida

```bash
git clone <url-do-repositório>
cd mobility-api
npm install
```

Crie `.env` na raiz (veja [Variáveis de ambiente](#variáveis-de-ambiente)). Garanta o banco criado e rode as migrações:

```bash
npm run migration:run
npm run start:dev
```

A API escuta em **`http://0.0.0.0:3000`** por padrão (`PORT` configurável).

---

## Variáveis de ambiente

**Obrigatórias para funcionamento mínimo local**

| Variável | Descrição |
|----------|-----------|
| `DATABASE_HOST` | Host PostgreSQL (default `localhost`) |
| `DATABASE_PORT` | Porta (default `5432`) |
| `DATABASE_USER` | Usuário |
| `DATABASE_PASSWORD` | Senha |
| `DATABASE_NAME` | Nome do banco (ex.: `Mobility`) |
| `JWT_SECRET` | Segredo para assinar JWT (não use o default em produção) |

**Integrações (conforme uso)**

| Variável | Descrição |
|----------|-----------|
| `GOOGLE_API_KEY` | Directions, Street View, parte de mapas |
| `GOOGLE_MAPS_API_KEY` | Alternativa/overload para alguns serviços |
| `GEMINI_API_KEY` | Análise de acessibilidade em imagens |
| `ORS_API_KEY` | OpenRouteService |
| `HERE_API_KEY` | HERE pedestrian / browse |
| `OPENWEATHER_API_KEY` | Clima no trajeto |
| `FOURSQUARE_API_KEY` | Pontos de interesse |
| `WHEELMAP_API_KEY` | Locais acessíveis próximos |
| `OTP_URL` | Base do servidor OTP (fallback e rotas fora das regiões configuradas) |
| `OTP_URL_MONTES_CLAROS` | OTP dedicado a Montes Claros (bbox em `src/routes/utils/otp-region.util.ts`) |
| `OTP_URL_BRASILIA` | OTP dedicado a Brasília/DF |
| `OTP_URL_SAO_PAULO` | OTP dedicado a São Paulo/SPTrans |
| `OTP_TIMEOUT_MS` | Timeout de chamada OTP em ms (default `4500`) |
| `OTP_REQUIRED_IN_PROD` | Em produção, falha startup se **nenhuma** URL OTP estiver configurada (default `true`) |
| `ACCESSIBILITY_AGENT_ENABLED` | Liga o agente LLM (Gemini) que rotula `alone`/`accompanied` por persona (default `true` quando há `GEMINI_API_KEY`). Veja `ACCESSIBILITY_LLM_AGENT_SPEC.md`. |
| `ACCESSIBILITY_AGENT_MODEL` | Modelo Gemini usado pelo agente (default `gemini-2.5-flash-lite`) |
| `ACCESSIBILITY_AGENT_ALONE_MIN_SCORE` | Score mínimo (0–100) para o agente rotular uma rota como `alone` (default `70`) |
| `ACCESSIBILITY_AGENT_TIMEOUT_MS` | Timeout da chamada ao agente em ms (default `8000`) |
| `RESEND_API_KEY` | Envio de e-mails de verificação / reset |
| `RESEND_FROM_EMAIL` | Remetente |
| `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, `FIREBASE_PRIVATE_KEY` | Push notifications |
| `UBER_CLIENT_ID` | Estimativas Uber (header conforme implementação) |
| `PORT` | Porta HTTP (default `3000`) |

> Nunca commite `.env` com segredos reais. Mantenha-o no `.gitignore`.

---

## Banco de dados e migrações

- **`synchronize: false`** — alterações de schema via migrations TypeORM em `src/migrations/`.
- Scripts SQL pontuais em `migrations/` (ex.: colunas `accompanied` em `users` / `routes`) para ambientes que aplicam SQL manualmente.

```bash
npm run migration:run
# Geração de nova migration (requer data-source / entidades alinhadas):
npm run migration:generate -- src/migrations/NomeDaMigration
```

O CLI TypeORM usa `src/data-source.ts` para `migration:run`.

---

## Scripts npm

| Script | Descrição |
|--------|-----------|
| `npm run start:dev` | Nest em modo watch |
| `npm run build` | Compila para `dist/` |
| `npm run start:prod` | `node dist/main.js` |
| `npm test` | Jest (inclui `src/**/*.spec.ts` e `src/tests/**/*.spec.ts`) |
| `npm run test:cov` | Cobertura |
| `npm run test:e2e` | E2E (`test/jest-e2e.json`) |
| `npm run lint` | ESLint |
| `npm run migration:run` | Aplica migrations pendentes |

---

## Módulos e rotas HTTP

Visão resumida (prefixos podem exigir **Bearer JWT** conforme guard nas controllers).

| Prefixo | Métodos principais |
|---------|---------------------|
| **`GET /`** | Health / hello (app controller) |
| **`/auth`** | `POST login`, `google`, `verify-email`, `resend-verification`, `forgot-password`, `verify-reset-code`, `reset-password` |
| **`/users`** | `POST` cadastro, `GET me`, `PATCH me`, `GET :id` |
| **`/places`** | CRUD + `GET nearby` |
| **`/routes`** | `POST check`, `GET :id`, `GET history/:user_id` |
| **`/lines`** | Listagem, `GET :id`, `POST seed` (uso controlado) |
| **`/stations`** | `GET nearby` |
| **`/here`** | `GET nearby` |
| **`/accessibility`** | `GET nearby` |
| **`/notifications`** | registro FCM, teste |
| **`/uber`** | `estimate`, `deeplink` |

Consulte os arquivos `*.controller.ts` em cada pasta para parâmetros exatos e guards.

---

## Contrato `POST /routes/check`

Corpo típico (DTO `CheckRouteDto`):

```json
{
  "user_id": 1,
  "origin": "Endereço ou texto livre de origem",
  "destination": "Endereço ou texto livre de destino",
  "transport_type": "bus",
  "accompanied": "alone",
  "time_filter": "leave_now",
  "time_value": "08:00",
  "route_preference": "less_walking"
}
```

- **`accompanied`:** `alone` prioriza rotas mais acessíveis; caso contrário perfil **acompanhado** (ordenção e avisos diferentes).
- **`time_filter` / `time_value`:** repassados ao provedor de rotas quando aplicável.
- Resposta inclui objeto **`route`** persistido (histórico), array **`routes`** com estágios analisados (clima, uber, imagens, alertas de inclinação, etc.) e **`search_profile`**.

---

## Testes

- **Unitários / integração:** `src/**/*.spec.ts` (serviços, controllers).
- **Suites adicionais em `src/tests/`:** personas de deficiência, fluxos de usuário, regressões de bugs conhecidos, contratos esperados pelo frontend (documentação executável).

```bash
npm test
npm run test:cov
```

---

## Deploy e produção

1. Defina `JWT_SECRET` e credenciais de BD seguras.
2. Rode `npm run build` e execute `node dist/main.js` (ou PM2/Docker).
3. Configure HTTPS atrás de proxy reverso em produção.
4. Aplique todas as migrations antes de subir nova versão.

---

## Segurança

- Use **JWT forte** e rotação de segredos em produção.
- Restrinja **CORS** se necessário (ajuste em `main.ts` conforme política do deploy).
- Revogue e rotacione chaves de APIs externas se expostas.

---

## Licença

Projeto **privado** (`UNLICENSED` em `package.json`). Uso e redistribuição conforme acordo dos mantenedores.
