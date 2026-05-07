# Testes (Mobility + API)

## App (Jest + RTL)

```bash
cd Mobility
npm test
```

- `npm run test:coverage` — cobertura
- `npm run test:watch` — modo watch
- Testes em `tests/*.test.tsx` e `services/__tests__/*.test.ts`
- E2E Maestro: fluxos em `.maestro/` (requer [Maestro](https://maestro.mobile.dev) no PATH e app no emulador)

```bash
npm run test:e2e:maestro
```

Se o Maestro não estiver instalado, instale conforme a documentação oficial (Windows: instalador ou `winget`).

## API (Nest Jest)

```bash
cd mobility-api
npm test
```

## Pré-deploy (manual, resumo)

1. `npm test` em **Mobility** e **mobility-api**
2. `npm run lint` no app
3. Com dispositivo/emulador: `test:e2e:maestro` (ajuste `appId` em `.maestro/smoke.yaml` para dev client ou produção)
4. TalkBack/VoiceOver: login → busca → resultados (aba sozinho/acompanhado) → detalhe

## Personas (matriz rápida)

- **Visual:** leitor de tela nos fluxos 1–4 do plano de QA
- **Cadeirante:** rotas e avisos de acessibilidade
- **Mobilidade reduzida:** preferências “caminhar menos” / menos trocas
