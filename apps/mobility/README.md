# Mobility

Cliente mobile do ecossistema **Mobility**: aplicativo em **React Native** com **Expo** para planejar deslocamentos urbanos com foco em **acessibilidade** — deficientes visuais, usuários de cadeira de rodas e pessoas com mobilidade reduzida.

---

## Sumário

- [Visão geral](#visão-geral)
- [Stack e requisitos](#stack-e-requisitos)
- [Estrutura do repositório](#estrutura-do-repositório)
- [Configuração da API](#configuração-da-api)
- [Instalação e scripts](#instalação-e-scripts)
- [Fluxos principais (telas)](#fluxos-principais-telas)
- [Testes e qualidade](#testes-e-qualidade)
- [Acessibilidade](#acessibilidade)
- [Problemas comuns](#problemas-comuns)
- [Backend](#backend)
- [Licença](#licença)

---

## Visão geral

O app é o front-end do **`mobility-api`**: autenticação, busca de rotas com análise de trechos (inclinação, imagens, transporte), lugares, linhas/estações e preferências de perfil. A interface prioriza **rótulos de acessibilidade**, **tipografia escalável** e suporte a **preferências de superfície** (contraste, redução de movimento, etc.) via contexto de acessibilidade.

Identidade visual centrada no **cão guia** e na paleta azul de acesso (**#0057A8**).

---

## Stack e requisitos

| Item | Versão / notas |
|------|----------------|
| **Node.js** | 18+ recomendado |
| **Expo SDK** | ~54 |
| **React Native** | 0.81.x |
| **React** | 19.x |
| **TypeScript** | ~5.9 |
| **Navegação** | [Expo Router](https://docs.expo.dev/router/introduction/) (rotas em `app/`) |
| **Mapas** | `react-native-maps` |
| **Testes** | Jest + `jest-expo`, Testing Library React Native |

**Dispositivo:** [Expo Go](https://expo.dev/go) ou **development build** (`expo-dev-client`) para recursos nativos completos.

---

## Estrutura do repositório

```
Mobility/
├── app/                    # Rotas e telas (Expo Router)
│   ├── _layout.tsx         # Layout raiz, fontes, tema de acessibilidade
│   ├── index.tsx, splash.tsx
│   ├── login.tsx, register.tsx, forgot-password.tsx, reset-password.tsx, …
│   ├── home.tsx, search-destination.tsx
│   ├── route-plan.tsx, route-results.tsx, route-detail.tsx
│   ├── lines.tsx, stations.tsx, directions.tsx
│   ├── profile.tsx, profile-info.tsx, profile-history.tsx
│   └── …
├── components/             # UI reutilizável (ex.: ScaledText)
├── constants/              # api.ts (URL base), acessibilidade, etc.
├── contexts/               # Preferências de acessibilidade
├── services/               # Chamadas HTTP, token, fetch de rotas
├── utils/                  # Lógica pura compartilhada (ex.: route-results-logic)
├── tests/                  # Testes RTL do app
├── assets/                 # Imagens, fontes
├── mocks/                  # Dados e flags de mock
├── docs/                   # Documentação auxiliar (ex.: testes)
├── .maestro/               # Fluxos E2E (Maestro)
├── jest.config.js
├── jest.setup.js
└── package.json
```

---

## Configuração da API

A URL base está em `constants/api.ts`.

1. **Recomendado em desenvolvimento:** crie `.env` na raiz do app com  
   `EXPO_PUBLIC_API_URL=http://SEU_IP_LOCAL:3000`  
   (mesma rede Wi‑Fi que o celular; sem barra no final).

2. **Sem `.env`:** o app tenta deduzir o host a partir do **Metro** (`debuggerHost` / `hostUri`). Em **tunnel** (`*.exp.direct`, `u.expo.dev`, ngrok) isso **não** alcança o Nest local — use sempre `EXPO_PUBLIC_API_URL`.

3. **Emulador Android:** se o Metro aparecer como `127.0.0.1`, a API é mapeada para `http://10.0.2.2:3000`.

4. **Reinicie o bundler** após alterar `.env`.

---

## Instalação e scripts

```bash
git clone <url-do-repositório>
cd Mobility
npm install
```

| Script | Descrição |
|--------|-----------|
| `npm run start` | `expo start --go` — QR para Expo Go |
| `npm run start:dev` | `expo start --dev-client` — cliente de desenvolvimento |
| `npm run android` / `npm run ios` | Build/run nativo (`expo run:*`) |
| `npm run web` | Experimento web |
| `npm run lint` | ESLint (Expo) |
| `npm test` | Jest (suíte unitária/integração leve) |
| `npm run test:watch` | Jest em modo watch |
| `npm run test:coverage` | Cobertura |
| `npm run test:e2e:maestro` | E2E com [Maestro](https://maestro.mobile.dev) (CLI no PATH + app no emulador) |

---

## Fluxos principais (telas)

| Área | Arquivos / notas |
|------|------------------|
| **Autenticação** | `login`, `register`, confirmação de e-mail, esqueci senha / reset |
| **Início / busca** | `home`, `search-destination`, planejamento e resultados de rota |
| **Rotas** | `route-plan`, `route-results` (filtros sozinho/acompanhado, tempo), `route-detail` |
| **Mobilidade urbana** | `lines`, `stations`, `directions` |
| **Perfil** | `profile`, `profile-info`, histórico `profile-history` |
| **Confirmação de favorito** | `favorite-location-confirm` |

Rotas reais e fallbacks dependem do **`mobility-api`** estar disponível e das variáveis de ambiente do backend (Google, Gemini, etc.).

---

## Testes e qualidade

- **Unitários / smoke:** `tests/*.test.tsx`, `services/__tests__/*.ts`, `utils/__tests__/*.ts`.
- **Detalhes e checklist:** `docs/TESTING.md`.
- **E2E:** `.maestro/smoke.yaml` — ajuste `appId` conforme dev client ou build de produção.

```bash
npm test
npm run test:coverage
```

---

## Acessibilidade

- Preferências globais em `contexts/accessibility-preferences.tsx` (cores de superfície, alto contraste, etc.).
- Componentes de texto dimensionável (`ScaledText` / `ScaledTextInput`).
- Fluxos críticos devem ser validados com **TalkBack** (Android) e **VoiceOver** (iOS); ver matriz em `docs/TESTING.md`.

---

## Problemas comuns

| Sintoma | O que verificar |
|---------|------------------|
| App não conecta na API | `EXPO_PUBLIC_API_URL`, firewall, IP da máquina, API escutando em `0.0.0.0:3000` |
| Tunnel Expo sem backend | Definir URL explícita; tunnel não resolve ao `localhost` do PC |
| Android emulador | `10.0.2.2` para localhost do host |

---

## Backend

Este repositório é apenas o **app**. A API NestJS está em **[mobility-api](https://github.com/letticiamallory/Mobility-API)** (ou no clone local **mobility-api**): autenticação JWT, `POST /routes/check`, lugares, linhas, estações, notificações, etc.

---

## Licença

Projeto **privado** (`"private": true` em `package.json`). Consulte os mantenedores quanto à redistribuição.
