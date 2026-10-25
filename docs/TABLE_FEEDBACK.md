# Feedback da mesa (inspirado no MTG Arena)

Levantamento de outubro de 2026, ramo `feat/table-feedback`. Compara a mesa atual com o feedback do Arena;
impacto e esforço de 1 (baixo) a 3 (alto). Estado: **feito** neste ramo, **proposta** à espera de aprovação.

## O que já existia

- Cartas jogáveis, atacantes e bloqueadores válidos realçados (`actionable` do Forge, `.is-actionable`).
- Setas de ataque e bloqueio (`CombatArrows`); jogador atacado destacado.
- Alvos do topo da stack com contorno tracejado (só cartas, não jogadores).
- Sons de clique, carta jogada, ataque, início de turno e fase; animações de lançar, entrar, marcadores, equipar,
  descartar/moinho e moeda ao ar.
- Faltava: saber quem tem a prioridade e de quem se está à espera; o que vai resolver; botão com o que faz.

## Lista priorizada

| # | Melhoria | Impacto | Esforço | Estado |
|---|---|---|---|---|
| 1 | Quem tem a prioridade: marca no cabeçalho do jogador; "a pensar" para IA/humanos remotos | 3 | 1 | feito |
| 2 | Barra: "À espera de {nome}" com segundos decorridos quando a decisão não é tua (também online) | 3 | 1 | feito |
| 3 | Botão principal contextual na prioridade: "Resolver" com stack, "Passar" sem stack (Fim do turno já vem do Forge) | 3 | 1 | feito |
| 4 | Stack: item que resolve a seguir realçado, dono de cada item, pré-visualização ao passar o rato | 3 | 1 | feito |
| 5 | Setas da stack para os alvos (cartas e jogadores), jogador alvo destacado | 3 | 2 | feito |
| 6 | Aviso "O teu turno" ao começar o turno | 2 | 1 | feito |
| 7 | Sons: prioridade com algo na stack para responder, stack a resolver, dano a um jogador, vitória/derrota | 2 | 1 | feito |
| 8 | Vida: número a subir/descer junto da vida (dano a vermelho, ganho noutra cor) e abanão em dano | 2 | 1 | feito |
| 9 | Criatura a morrer: carta fantasma do campo para o cemitério | 2 | 1 | feito |
| 10 | Vida baixa: aviso visual permanente e som ao passar 5 de vida | 1 | 1 | proposta |
| 11 | Animação de dano da fonte ao alvo (projétil/linha em combate e em feitiços) | 2 | 3 | proposta |
| 12 | Relógio de turno online com "corda" (limite de tempo, como o Arena) — precisa de regra no motor e acordo entre jogadores | 2 | 3 | proposta |
| 13 | Pedir alvo com seta a seguir o rato desde a carta ao escolher alvos | 2 | 2 | proposta |
| 14 | Paragem "plena" automática (Full Control) e tecla para passar até à próxima ação do adversário | 1 | 2 | proposta |
| 15 | Emotes rápidos online (frases fixas traduzidas, silenciáveis) | 1 | 2 | proposta |

## Como funciona (1–9)

- A ponte acrescenta `priorityPlayerId` (o `PlayerView.getHasPriority()` do Forge, sincronizado também online) e
  `prompt.priority` (o pedido atual é passar a prioridade: botões OK + Desfazer/Fim do turno do Forge).
- "À espera de" usa o jogador com prioridade quando a decisão não é tua; o contador de segundos é só da UI.
- Sons e animações novos seguem o padrão atual: comparação pura de snapshots (`gameSounds`, `planAnimations`),
  efeitos sintetizados, volume/mute e preferências por tipo (desligadas com reduced motion).
