# Design e acessibilidade — plano de implementação

Estado: primeira entrega implementada no ramo `feat/design-accessibility`, num worktree dedicado.
Origem: pesquisa e auditoria de 26/10/2026. A aplicação das sugestões foi autorizada pelo utilizador.
Orientação: **landscape** em todos os dispositivos, por indicação do utilizador. Portrait não faz parte da matriz de validação.

## Direção visual

Preservar as quatro identidades: Mesa (feltro verde `#1F3B2D`, papel `#EFE6D2`, tinta `#1C1A17`),
Editorial (papel `#F2F0EB`, tinta `#141414`, azul `#2F6FD0`), Retro (pergaminho `#E9DFC7`,
tinta `#2E2216`, ouro `#B8954A`) e Terminal (fundo `#0C0C0C`, texto `#D4D4D4`, âmbar `#FFB000`).
Separar foco, disponibilidade, escolha, prioridade e perigo, com cores adaptadas à superfície e sinais além da cor.
Na Mesa, experimentar menta `#8FD6C2` sobre feltro e verde `#006B57` sobre papel; na Retro, foco `#765518`.

Manter as fontes existentes: Work Sans / EB Garamond, Inter Tight, Crimson Pro / IM Fell English e JetBrains Mono.
As cartas e retratos transportam a identidade do jogo; fundos e controlos ficam discretos. Sem novos gradientes,
emoji ou descrições redundantes. Layouts alinhados à esquerda, com decisões e ações sempre reconhecíveis.

Revisão contra o projeto: uma reconstrução como dashboard de cartões eliminaria a identidade da mesa física.
Usar a grelha de modos existente, cabeçalhos compactos e folhas de definições com áreas de scroll internas.
Não acrescentar níveis de navegação para agrupar modos. Todo o visual novo usa tokens das quatro skins e todo o texto pt/en.

## Bloco A — navegação e estados (primeira entrega)

As caixas assinalam a implementação concluída. A validação executada e os limites por verificar estão registados no fim.

- [x] **1. Menu adaptável à altura.** Ajustar espaçamento, marca e grelha para mostrar os acessos a 1280×720.
  Aceitação: Decks, Online e Definições visíveis sem scroll nessa resolução; verificar também 844×390 em landscape.
- [x] **3. Definições consistentes.** Grupos Aparência, Áudio, Jogabilidade e Acessibilidade; título e Fechar fixos.
  Partilhar os controlos com o menu da partida. Mudar idioma apenas fora de partida; paragens apenas na partida.
  Aceitação: teclado, Escape, regresso do foco e mudanças de skin funcionam; todos os controlos são alcançáveis em janelas baixas.
- [x] **4. Contraste.** Tokens de foco para mesa/painel e cor de dano específica para o indicador de força/resistência.
  Aceitação: foco ≥3:1 e texto de dano ≥4,5:1 nas superfícies aplicáveis, nas quatro skins.
- [x] **5. Estados distintos.** Jogável com sinal de disponibilidade; selecionável tracejado; escolhido com marca de confirmação;
  alvo e prioridade mantêm sinais próprios. Escolha válida deixa de usar vermelho de perigo.
  Aceitação: estados reconhecíveis sem depender apenas da cor, inclusive com estados simultâneos e foco de teclado.
- [x] **7. Instruções da mesa.** Dar uma linha própria à decisão e manter os botões num local estável.
  Aceitação: pergunta completa a 1280×720; mesas de 2/4 jogadores e painel fechado/aberto sem sobreposição.

## Bloco B — leitura e acesso

- [x] **6. Escala e densidade.** Preferências locais de texto 100/125/150/200% e densidade Compacta/Confortável.
  Migrar tamanhos tipográficos fixos por componente; separar escala de texto de geometria das cartas.
  Aceitação: sem perda de ações nem scroll em dois eixos em menus; 200% verificado nos diálogos e com nomes longos.
- [x] **10. Inspeção e ajuda universais.** Um gesto de inspeção para mesa, listas, builder e lojas:
  clique direito, toque prolongado e atalho de teclado explícito. Tooltips por hover/foco/toque, sem esconder informação obrigatória.
  Aceitação: inspecionar não joga, compra nem altera quantidades; um gesto não dispara duas ações; foco regressa ao emissor.
- [x] **8. Confirmações específicas.** Mostrar quantidades e consequências que o Forge já fornece nos diálogos.
  Aceitação: escolher/ordenar/distribuir apresenta limites e confirmação coerentes; não inferir custos nem saltar decisões do motor.

## Bloco C — escolha de partidas e identidade

- [x] **2. Hierarquia do início.** Biblioteca lateral escolhida pelo utilizador: destaque para o modo mais jogado,
  até três atalhos de modos e Decks/Online/Definições estáveis. Abrir um modo exige intenção e não conta como jogar.
  Aceitação: primeira utilização, ausência de histórico, armazenamento indisponível e sessões repetidas verificados.
- [x] **9. Escolha visual de decks.** Lista com pré-visualização escolhida pelo utilizador: pesquisa, favoritos,
  comandante e identidade de cor. A proposta de recentes não faz parte desta variante.
  Reutilizar detalhe/previews do catálogo; distinguir decks próprios de pré-construídos; pedidos antigos não substituem seleção atual.
  Aceitação: catálogo grande, deck removido/renomeado, aleatório e carregamento/erro de imagens.
- [ ] **12. Arte nos pontos de escolha.** Retratos e recortes das cartas nos seletores de decks e campanhas.
  Aceitação: imagens existentes com fallback legível, sem downloads de arte decorativa nem competição com a mesa.
  A seleção de decks está concluída; a arte nos seletores de campanhas continua pendente.

### Lista com pré-visualização e mesa — 27/10/2026

Implementadas no ramo `feat/deck-picker`, a pedido do utilizador. A lista usa os comandantes, identidades e contagens
nativos de 180 pré-construídos e dos decks próprios; os favoritos distinguem a origem mesmo com nomes iguais.
Partida aleatória e definições individuais dos adversários mantêm os controladores do Forge.
Testes de pesquisa, parceiros, traduções, catálogo atualizado e armazenamento passaram; a seleção nativa de ambas as
origens com nomes iguais foi verificada até ao início da partida. No browser: favoritos após recarregar, inspeção por I,
quatro skins, 1280×720 e 844×390, e texto a 200% com scroll vertical e sem overflow horizontal no seletor.

A mesa passa a ter cabeçalho de turno/espera com Menu/Registo à direita e ações no rodapé direito.
Os limites dos campos inimigo e local coincidem. Verificados Cancelar/alvos, pagamento de mana e Resolver com stack,
além do início/mulligan; os controladores e atalhos existentes são reutilizados.

### Biblioteca lateral — 26/10/2026

O utilizador escolheu a direção Biblioteca e substituiu os pré-construídos pelos modos mais jogados.
Implementada em `feat/library-home`: seis modos na barra lateral, Decks/Online/Definições no cabeçalho,
destaque e até três atalhos ordenados por sessões reais. Sem histórico, mostra uma mensagem e Commander como entrada;
arte só de cartas já vistas em jogo, com ícone como alternativa. O histórico começa nesta versão e fica no dispositivo.
Esta entrega cobre a hierarquia do início com a escolha atual do utilizador; não acrescenta um botão Continuar campanhas.
Os pontos 9 e 12 continuam pendentes. A antiga proposta de manter a grelha foi substituída por esta escolha.

Validação: build, testes do histórico (sete modos, erros, persistência, duplicados) e browser em 1280×720 e
844×390, quatro skins e texto a 200% sem overflow horizontal (scroll vertical para alcançar o conteúdo).
Moeda inicial modal e topo da biblioteca foram igualmente revistos na mesa com o motor real e perfis descartáveis.

## Bloco D — orientação em Adventure

- [x] **11. Mapa e objetivos.** Missão acompanhada, identificação do local e símbolos de cidade/loja/masmorra/inimigo.
  Distinguir alvos de missões simultâneas; respeitar movimento reduzido também no canvas e manter os sprites originais.
  Aceitação: zero/uma/três missões, alvo fora do ecrã, mudança de região e marcadores estáticos com movimento reduzido.

## Validação e limites

- Build TypeScript/Vite e testes existentes relevantes: builder, importação, sons e animações.
- Verificação visual em landscape a 1440×900, 1280×720 e 844×390; quatro skins, pt/en, teclado e movimento reduzido.
- Dados temporários exclusivamente. Integrar o trabalho da main através dos seus commits e preservar quaisquer alterações locais no checkout original.
- Sem alterações ao Forge upstream, às regras do jogo, aos dados reais ou instaladores. Commit e merge autorizados pelo proprietário em 26/10/2026.
- Os blocos podem ser entregues separadamente. Assinalar só trabalho realmente implementado e validado.

## Validação da primeira entrega — 26/10/2026

- `npm run build`: passou (TypeScript e Vite). Ponte Java deste worktree compilada para o cenário de teste;
  motor e recursos de teste isolados em `.tools/design-check`, com dados descartáveis. Nenhuma alteração ao motor foi necessária.
- Passaram `ui:smoke-design`, `ui:smoke-appearance`, `ui:smoke-guidance`, `ui:smoke-builder`,
  `ui:smoke-import`, `ui:smoke-sounds` e `ui:smoke-animations`.
- Browser: menu a 1280×720 e 844×390 com Decks/Online/Definições visíveis; quatro skins e mudança pt/en;
  paragem de manutenção alterada e reposta pelo motor real; idioma bloqueado durante a partida.
- Leitura: 100/200% e densidade Compacta/Confortável verificadas; a 844×390, o seletor de secção substitui os
  separadores para deixar controlos utilizáveis e Fechar visível, sem overflow horizontal no diálogo.
- Mesa: cenário real com quatro jogadores, mão inicial, permanentes e saída com confirmação. Pergunta inicial completa.
  I inspeciona Sol Ring sem o virar; Escape devolve foco à mesma carta. No builder a 1440×900,
  I inspeciona Anel Solar sem alterar `0/100`, e o foco volta ao resultado do catálogo.
- Adventure: campanha descartável criada, mapa, local e legenda abertos. Seleção/fallback de missões,
  formas e setas fora do ecrã cobertas pelo teste determinístico.
- Por verificar: gestos num dispositivo touch real; missões ativas/lojas visitadas de ponta a ponta com a nova UI;
  todos os diálogos do Forge a 200%. Não se considera esta primeira entrega uma certificação completa de acessibilidade.
- Próximo bloco: pontos **2, 9 e 12** — hierarquia do início, seleção visual de decks e arte nos pontos de escolha.
  A preparação inicial foi concluída sem commits ou merges; a integração foi autorizada posteriormente.

## Integração com a main — 26/10/2026

- Rebase sobre `1796efa`, preservando a recuperação do relay (`b3a1e9e`) e a nova stack/troca de bloqueadores.
- Conflitos de CSS resolvidos com a grelha de instruções e a container query da fase atual preservadas.
  A stack passa a integrar o grupo de ações, para não criar uma célula implícita na grelha.
- A nova stack reutiliza a inspeção comum (I, Shift+F10, clique direito/toque), o foco de alto contraste e a escala de texto.
- Build TypeScript/Vite, compilação Java da ponte e sete testes UI passaram após o rebase.
  O teste local Worker/SQLite também passou, incluindo queda/reconexão do anfitrião e limpeza das salas.
- Browser com o cenário `blocks` da main: Grizzly Bears mudou de Craw Wurm para Gray Ogre; o registo do Forge
  confirmou o bloqueio final. A stack de Lightning Bolt aparece uma só vez junto às ações; I abre a carta,
  Escape restaura o foco e Espaço no botão da stack dobra/abre sem resolver o feitiço.
  A stack e os botões foram também verificados em landscape 844×390.

## Fontes da pesquisa

- [XAG 101 — texto](https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/101)
- [XAG 102 — contraste](https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/102)
- [XAG 103 — canais e cor](https://learn.microsoft.com/en-us/xbox/accessibility/xbox-accessibility-guidelines/103)
- [XAG 112 — navegação](https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/112)
- [XAG 113 — foco](https://learn.microsoft.com/en-us/gaming/accessibility/xbox-accessibility-guidelines/113)
- [Game Accessibility Guidelines](https://gameaccessibilityguidelines.com/basic/)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [Arena — Sylvan Library](https://magic.wizards.com/en/news/mtg-arena/dev-diary-sylvan-library)

As direções estéticas são propostas do projeto; as referências sustentam legibilidade, consistência e interação.
As dimensões XAG de texto são alturas renderizadas, não equivalentes diretos a `font-size` CSS.
