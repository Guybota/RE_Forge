# Salas por código

O anfitrião executa o Forge. O serviço Cloudflare encaminha o protocolo nativo entre ele e até três convidados;
não executa regras, não guarda decks nem estados de jogo, e não recebe o WebSocket da interface.
Todos os computadores fazem ligações de saída HTTP/WebSocket; os jogadores não configuram o router.

## Configuração da aplicação

O motor lê `RE_FORGE_RELAY_URL` (ou a propriedade Java `reforge.relay.url`). Aceita uma origem HTTPS,
sem caminho, credenciais, query ou fragmento. HTTP só é permitido em `localhost`, `127.0.0.1` ou `[::1]` para testes.
Sem configuração, a ligação direta continua disponível e a opção por código fica desativada.

Em desenvolvimento, depois de iniciar o serviço local:

```powershell
$env:RE_FORGE_RELAY_URL = 'http://127.0.0.1:8787'
npm run dev
```

Para distribuir uma versão com um serviço já publicado, preencher `config.relayUrl` em `desktop/package.json`
com a origem real antes de empacotar. A variável de ambiente tem precedência. Não são necessárias chaves Cloudflare
nos clientes. A opção fica automaticamente em **Por código** quando existe uma origem configurada.

## Serviço e testes locais

```powershell
npm install
npm run relay:dev
npm run relay:smoke
$env:JAVA_HOME = 'C:/Program Files/Eclipse Adoptium/jdk-21.0.12.101-hotspot'
npm run engine:build
npm run engine:smoke-relay
$env:SMOKE_ONLINE_HUMANS = '4'
npm run engine:smoke-relay
Remove-Item Env:SMOKE_ONLINE_HUMANS
$env:SMOKE_ONLINE_AI = '1'
npm run engine:smoke-relay
Remove-Item Env:SMOKE_ONLINE_AI
```

Os testes arrancam o Worker real com Miniflare/workerd e Durable Objects SQLite temporários. Não usam uma conta
Cloudflare. Os motores usam exclusivamente pastas de dados temporárias. Não executar dois testes com motores em
paralelo: o arranque do Forge lê um perfil junto aos recursos partilhados.

`relay:smoke` verifica autorização do anfitrião, lotação, canais separados, isolamento entre salas, tentativa de
falsificar um canal, limite das mensagens, limitação de pedidos e fecho dos convidados quando sai o anfitrião.
`engine:smoke-relay` exercita lobby, decks, chat, mãos privadas, turnos, paragens remotas e concessão pelo túnel.
Inclui cancelar uma concessão sem perder o lugar e voltar a entrar noutra sala; a saída do anfitrião fecha o lobby
do convidado. Erros de salas inexistentes, lotação, excesso de tentativas e perda de ligação têm códigos traduzidos
na interface em português e inglês.

O adaptador `OnlineController` liberta o input pendente de um humano remoto depois da sua concessão individual.
Continua a delegar as regras e os restantes comandos no controlador do Forge. Esta libertação acontece na mesma
chamada: enviar um segundo RPC de confirmação criaria uma corrida, porque o Forge executa esses RPCs em threads distintas.
As variantes com quatro humanos e com humanos/IA cobrem este caso.

## Publicação

Publicado em 2026-10-25 na conta Cloudflare do proprietário (plano gratuito):
`https://reforge-relay.tempo-portugal.workers.dev`, configurado em `desktop/package.json` → `config.relayUrl`.
Testado contra o serviço publicado com `RE_FORGE_RELAY_URL=<origem> npm run engine:smoke-online-lobby -- --relay`
e `node scripts/smoke-online.mjs --relay`. Para atualizar o serviço, repetir os passos abaixo.

O código está em `relay/src/worker.js`; a configuração está em `relay/wrangler.jsonc`.

```powershell
cd relay
npx wrangler login
npx wrangler deploy --dry-run
npx wrangler deploy
```

Estas instruções não publicam automaticamente: o último comando cria o serviço na conta autenticada.
Usar uma conta no plano **Workers Free**, com Durable Objects SQLite, e confirmar as condições atuais no painel.
Não é necessário contratar o plano pago nem alojar motores Java na Cloudflare.

Depois de publicar, configurar a origem HTTPS apresentada pelo Wrangler na aplicação e testar a partir de duas
redes reais. A validação local não demonstra acesso pela Internet, latência ou capacidade do plano gratuito.

## Protocolo do relay

- `POST /rooms` cria uma sala e devolve `{code, hostToken}`. O código contém 40 bits aleatórios; o segredo do anfitrião
  contém 256 bits. A resposta não é guardada em cache.
- `GET /rooms/CODE?role=host`, com WebSocket Upgrade e `Authorization: Bearer hostToken`, liga o anfitrião.
- `GET /rooms/CODE?role=guest`, com WebSocket Upgrade, liga um convidado que conhece o código.
- O relay envia controlo JSON: `ready {channel}`, `peerJoined {channel}` e `peerLeft {channel}`.
- Mensagens binárias: identificador de canal de 4 bytes, big-endian, seguido de 1–32768 bytes do stream TCP.
  O convidado só pode enviar no seu próprio canal; apenas o anfitrião pode escolher o destinatário.
- O anfitrião pode enviar `disconnect {channel}` para fechar um convidado recusado pelo Forge.
- Os identificadores não são reutilizados dentro de uma sala. Um fragmento atrasado não pode passar para outro jogador.

No anfitrião, cada canal abre uma ligação TCP local ao servidor Forge. No convidado, o cliente Forge liga-se a um
listener temporário em `127.0.0.1`. Os leitores/escritores da ponte correm em threads próprias, com filas limitadas
e limites de espera para o envio WebSocket. A interface continua a receber os snapshots habituais do motor local.
O listener nativo de netplay do Forge mantém o comportamento upstream; o modo por código desativa UPnP e não publica
os seus endereços. Esta implementação não altera ficheiros em `forge/`.

## Limites e recuperação

- Quatro humanos no máximo por sala, contando o anfitrião; os lugares de IA continuam a ser geridos pelo Forge.
- Salas expiram após 24 horas. Sair do anfitrião fecha a sala; uma nova partida pode criar outro código.
- A ligação perdida ao relay fecha o lobby e apresenta um erro. Não há recuperação automática do túnel nem migração
  de anfitrião nesta versão; não confundir isto com a reconexão nativa do Forge em ligações diretas.
- O código de convite permite entrar; ainda não há contas, lista pública nem matchmaking automático.
- A instância usa a API de hibernação: não mantém timers ativos nem guarda snapshots no armazenamento Cloudflare.
- Pedidos de criação/ligação são limitados a 30 por minuto por IP e localização Cloudflare. É uma proteção aproximada,
  não um limite global estrito. Mensagens acima de 32 KiB + cabeçalho são rejeitadas.
- O tráfego passa pelo relay; WSS protege cada ligação, mas não oferece encriptação ponta a ponta perante o operador
  do relay. Não registar payloads de jogo nem o segredo do anfitrião.
- Não existe capacidade ilimitada gratuita: ao atingir as quotas do plano Free, operações podem falhar e interromper
  partidas. Medir consumo real antes de prometer uma capacidade em mesas simultâneas.

Referências: [preços e quotas](https://developers.cloudflare.com/durable-objects/platform/pricing/),
[WebSockets e hibernação](https://developers.cloudflare.com/durable-objects/best-practices/websockets/),
[limitação de pedidos](https://developers.cloudflare.com/workers/runtime-apis/bindings/rate-limit/).
