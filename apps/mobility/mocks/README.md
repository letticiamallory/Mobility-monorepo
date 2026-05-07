# Mocks de teste

Esta pasta contém dados mockados para testes locais.
**Remover antes de ir para produção.**

## Arquivos

- `addresses.ts` — endereços reais de Montes Claros para testar autocomplete e busca de rotas
- `weather.ts` — condições climáticas simuladas. Troque `ACTIVE_MOCK_WEATHER` para testar diferentes cenários

## Como usar

```ts
import { MOCK_ADDRESSES, ACTIVE_MOCK_WEATHER } from '../mocks';
```

## Para desativar os mocks

Basta não importar os arquivos desta pasta e usar as APIs reais.
