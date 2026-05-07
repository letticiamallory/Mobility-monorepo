# Investigação: cadastro, Google, avatar, rotas e estações (Mobility + mobility-api)

Documento para investigação e correção **sem alterar** a lógica de produto **“Sozinho” vs “Acompanhado”** (particionamento de rotas, abas, `search_profile`, etc.). Essa parte está **fora de escopo** e deve permanecer como está.

---

## Contexto

- **App:** Expo / React Native (`Mobility/`), API base em `constants/api.ts` (`EXPO_PUBLIC_API_URL` ou fallback por IP do Metro).
- **Backend:** NestJS (`mobility-api/`), porta típica `3000`.
- **Tráfego crescente:** cadastros em `POST /users`, login `POST /auth/login`, Google `POST /auth/google`, rotas autenticadas `POST /routes/check` (JWT).

---

## 1. Cadastro por e-mail “não funciona” / parece impossível

### Sintomas relatados

- Não consegue concluir cadastro ou não consegue entrar depois.

### Achados no código (alta prioridade)

#### 1.A Corpo da requisição do app vs DTO do backend

- **App:** `Mobility/services/auth.service.ts` → `register()` envia JSON para `POST ${API_URL}/users` com:
  - `name`, `email`, `password`, `disability_type`, opcionalmente `accompanied`.
- **Backend:** `mobility-api/src/users/dto/create-user.dto.ts` exige:
  - `confirm_password` como campo **obrigatório** (`@IsString()`, `@IsNotEmpty()`, `@MinLength(6)` alinhado à senha).
- O app **não envia** `confirm_password`. O formulário em `app/register.tsx` tem confirmação de senha no UI (`passwordsMatch`), mas `handleSubmit` chama apenas `register(name, email, password, disabilityType)` — **a segunda senha não vai na API**.

**Hipótese forte:** o `ValidationPipe` do Nest rejeita o body com **400** antes de chegar em `AuthService.register()`. O usuário vê erro genérico ou “cadastro recusado”.

**Ação sugerida:** alinhar contrato:

- Opção A: app passar `confirm_password` (igual ao campo de confirmação do formulário), ou
- Opção B: tornar `confirm_password` opcional no DTO **somente se** a validação “senhas coincidem” for 100% no app (menos seguro no servidor).

#### 1.B Fluxo pós-cadastro: verificação de e-mail

- **Backend:** `AuthService.register()` (`auth.service.ts`) cria usuário com `email_verified: false`, gera código e tenta enviar e-mail via `ResendService`.
- **Login:** `AuthService.login()` bloqueia login se `email_verified === false`, exceto se:
  - `AUTH_ALLOW_UNVERIFIED_LOGIN` estiver habilitado, ou
  - o e-mail estiver em `AUTH_VERIFICATION_BYPASS_EMAILS`.

**Hipótese:** cadastro “funciona” no servidor (201/200 com mensagem), mas o app mostra “Cadastro concluído” e o usuário **não consegue logar** até verificar o e-mail — e o app pode **não** levar o usuário para uma tela de “digite o código” logo após o registro.

**Ação sugerida:**

- Garantir fluxo UX: após registro, ou tela de verificação + `POST /auth/verify-email` (confirmar rota exata no `auth.controller`), ou mensagem clara “Verifique seu e-mail”; em dev, documentar `AUTH_ALLOW_UNVERIFIED_LOGIN` para testes.
- Verificar se `RESEND_API_KEY` / `RESEND_FROM_EMAIL` estão configurados; falha no envio **não** impede `save(user)`, mas o usuário nunca recebe o código.

#### 1.C Validação de e-mail

- DTO usa `@IsEmail()` + no serviço há regex adicional. Não parece o problema principal frente a `confirm_password` ausente.

---

## 2. Foto / avatar não “salva”

### Sintomas

- Ao trocar a foto no cadastro ou no perfil, a imagem não persiste ou “some”.

### Achados

#### 2.A Cadastro (`app/register.tsx`)

- `avatarUri` é estado local; `pickAvatarImage` só faz `setAvatarUri`.
- `handleSubmit` chama `register(...)` **sem** enviar avatar nem multipart para a API.
- **Conclusão:** avatar no cadastro **nunca foi persistido** no backend; só existiria na sessão local se alguém ligasse isso depois do login.

#### 2.B Perfil (`app/profile-info.tsx`)

- Após escolher imagem, chama `saveUserAvatar(uri)` em `services/token.service.ts`.
- Implementação: grava a **string URI** no SecureStore (`USER_AVATAR_KEY`).
- URIs de `ImagePicker` no Android/iOS costumam ser **temporárias** (`file://` / `content://`). Após reinício do app ou limpeza de cache, o caminho pode ficar **inválido** → parece que “não salvou”.
- Não há upload para S3/backend nem `PATCH /users/me` com URL de avatar (verificar se `UpdateMeDto` suporta foto — hoje o fluxo é só local).

**Ação sugerida:**

- Curto prazo: persistir cópia estável (ex.: `expo-file-system` em diretório de documentos) e guardar esse path, ou Base64 (com tamanho limitado).
- Médio prazo: endpoint de upload + campo `avatar_url` no usuário + app envia arquivo após pick.

---

## 3. Login com Google não funciona

### Arquivos-chave

- **App:** `components/GoogleLoginSection.tsx`, `services/google-auth.service.ts`, `app/login.tsx`.
- **Backend:** `POST /auth/google` com `GoogleAuthDto` (`email`, `name`, `googleId`, `token`).

### Comportamento esperado

- **Expo Go:** `useIdTokenAuthRequest` + `webClientId`; redirect URI deve estar em Google Cloud Console.
- **Dev client / release:** `signInWithGoogleNative()` com `@react-native-google-signin/google-signin`, `webClientId: EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`.

### Pontos de falha comuns

1. **`EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`** incorreto ou não injetado no EAS (perfis `preview` / `development` / `production`).
2. **Android:** SHA-1/SHA-256 do keystore de **debug** e de **release** registrados no Firebase/Google Cloud; package `com.mobility.app` (`app.json`).
3. **`id_token` vazio** no nativo: versão da lib / config `offlineAccess` / cliente OAuth errado (Android client id vs Web client id).
4. **API:** `POST ${API_URL}/auth/google` inalcançável no celular (mesmo problema de `EXPO_PUBLIC_API_URL`).
5. **GoogleAuthErrorBoundary:** qualquer erro de render no filho pode mostrar “Login com Google indisponível” e esconder a causa — checar logs.

**Ação sugerida:** reproduzir com `adb logcat` / Metro; inspecionar resposta HTTP e corpo de erro da API; validar projeto Google Cloud e EAS env.

---

## 4. Rotas: “não acha trajeto nenhum”

### Escopo explícito

- **Não alterar** lógica de separação **alone / companied** (partição, abas, filtros de acessibilidade que já funcionam).

### Fluxo atual

- App: `fetchDiverseRoutes` → várias chamadas `searchRoutes` → `POST /routes/check` com Bearer token (`services/routes.service.ts`).
- Backend: `RoutesService.checkRoute` — geocodificação (Nominatim + coords opcionais), OTP (`OtpService.planRoute`), fallback Google (`GoogleRoutesService`), depois enriquecimento e partição.

### Causas prováveis (checklist)

| Causa | Onde verificar |
|--------|----------------|
| App não alcança API | `EXPO_PUBLIC_API_URL`; tunnel vs LAN; `constants/api.ts` log em `__DEV__` |
| 401/403 em `/routes/check` | Token ausente/expirado; `user_id` do body ≠ JWT (`ForbiddenException`) |
| OTP vazio | `OTP_URL`, `OTP_URL_MONTES_CLAROS`, `OTP_URL_BRASILIA`, `OTP_URL_SAO_PAULO` no `.env` da API; instância OTP rodando; região da rota |
| Google fallback vazio | `GOOGLE_API_KEY` no backend; APIs Directions/Transit habilitadas; cotas |
| Timeout | Cliente ~15s por requisição em `searchRoutes`; `fetchDiverseRoutes` paralelo + fallback `bus` |
| Cobertura geográfica | App: `utils/mobility-coverage.ts` redireciona para `/out-of-coverage` se origem **e** destino com coords **fora** das caixas MC/DF/SP |
| Erros engolidos | `Promise.allSettled` em `fetch-diverse-routes.ts` ignora rejects; em `__DEV__` há `console.warn` por transporte — usar isso |

**Ação sugerida:** com um usuário logado, chamar `POST /routes/check` via curl/Insomnia com o mesmo body do app; ver logs `[checkRoute]` no servidor; confirmar OTP e Google.

---

## 5. Estações: lista vazia

### Fluxo

- App: `GET ${API_URL}/stations/nearby?lat=&lng=` (`app/stations.tsx`).
- Backend: `StationsService.getNearby` usa **Google Places Nearby Search**; se `GOOGLE_MAPS_API_KEY` / `GOOGLE_API_KEY` estiver ausente, retorna **`[]`** (array vazio, 200).

### Comportamento recente no app (para referência)

- Foi adicionado **fallback** com `MOCK_STATIONS` **somente** quando o usuário está na **área de Montes Claros** (`isInMontesClarosArea`) e a API falha ou vem vazia. Em **SP/Brasília**, lista vazia continua possível se Places não responder.

**Ação sugerido:** garantir chave Google no **mobility-api**; habilitar Places API; revisar raio/tipos em `stations.service.ts`.

---

## 6. Correção já feita na API (histórico de rotas)

- **Problema:** em `routes.controller.ts`, `GET history/:user_id` estava **depois** de `GET :id`, fazendo `/routes/history/1` bater em `:id = "history"` (ParseIntPipe falha).
- **Correção:** declarar `history/:user_id` **antes** de `:id`. Vale confirmar em deploy que essa versão está no ar.

---

## 7. Ordem sugerida de investigação (para o Opus)

1. **Cadastro:** reproduzir `POST /users` com o body exato do app; corrigir `confirm_password` + fluxo de verificação de e-mail + mensagens no app.
2. **Login Google:** variáveis EAS + Google Console + teste de `id_token` + resposta `/auth/google`.
3. **Avatar:** decidir persistência (local estável vs upload); ajustar `saveUserAvatar` / cadastro.
4. **Rotas:** conectividade → JWT → logs `checkRoute` → OTP → Google; não tocar na partição alone/companied.
5. **Estações:** chave Places no backend; fallback regional se produto exigir SP/DF além de mock MC.

---

## 8. Variáveis de ambiente (referência rápida)

**App (`.env` / EAS secrets)**  
`EXPO_PUBLIC_API_URL`, `EXPO_PUBLIC_GOOGLE_API_KEY`, `EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID`, opcional `EXPO_PUBLIC_ENABLE_GOOGLE_LOGIN`.

**API (`mobility-api/.env`)**  
`DATABASE_*`, `JWT_*`, `GOOGLE_API_KEY` / `GOOGLE_MAPS_API_KEY`, URLs `OTP_*`, `RESEND_*`, `AUTH_ALLOW_UNVERIFIED_LOGIN`, `AUTH_VERIFICATION_BYPASS_EMAILS`, etc.

---

## 9. Testes de aceitação sugeridos

- [ ] Cadastro com duas senhas iguais → usuário criado → e-mail recebido OU flag dev de login sem verificação → login OK.
- [ ] Login Google (dev client e release) → token + `user_id` retornados.
- [ ] Trocar avatar no perfil → após kill do app, foto ainda aparece (ou URL no servidor).
- [ ] Busca origem/destino dentro de MC/DF/SP com usuário logado → pelo menos uma alternativa de rota ou erro explícito da API.
- [ ] Abas **Sozinho** / **Acompanhado** inalteradas em conteúdo e regras após as correções.

---

*Gerado para handoff de investigação; ajustar datas/commits conforme o estado do repositório no momento da leitura.*
