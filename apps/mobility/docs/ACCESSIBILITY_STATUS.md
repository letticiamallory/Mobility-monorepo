# Acessibilidade — situação e meta

## Commit de referência (infra)

- Preferências locais: fonte A/AA/AAA, alto contraste, leitura por voz (`AsyncStorage` + contexto).
- `ScaledText` / `ScaledTextInput`, tema Paper + React Navigation, superfícies dinâmicas.
- TTS no detalhe da rota condicionado à preferência “Leitura por voz”.
- Scroll na seção Acessibilidade do perfil.

## Branch `feature/a11y-wcag-90`

Eleva o app em direção a **~90%** de boas práticas para os três perfis declarados (visual, cadeirante, mobilidade reduzida), com foco em:

- `accessibilityLabel` / `accessibilityRole` / `accessibilityState` / `accessibilityHint` nos fluxos principais.
- `hitSlop` para alvos de toque mais confortáveis.
- `useReduceMotion` para respeitar “reduzir movimento” do sistema em animações pontuais.

## Testes recomendados

- Percorrer login → busca → resultados → detalhe com **TalkBack** e **VoiceOver**.
- Validar alto contraste e fonte AAA em **Perfil → Acessibilidade**.
