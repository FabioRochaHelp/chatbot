# ConectZap

Plataforma open source de atendimento pelo WhatsApp: API para integrar sistemas, painel com inbox para a equipe, bot de fluxos com editor visual, assistentes de IA (Claude) e webhooks.

O ConectZap usa o [WPPConnect](https://github.com/wppconnect-team/wppconnect): um Chromium sem interface abre o WhatsApp Web e o ConectZap o controla por código. Cada **sessão** é um número de WhatsApp conectado lendo um QR code, como no WhatsApp Web.

## O que tem

- **Painel web** com login, tema claro/escuro e layout para celular.
- **Atendimento (inbox):** fila, conversas atribuídas a cada atendente, chat com mídia em tempo real, transferência entre atendentes, notas internas, respostas rápidas, etiquetas e notificações.
- **Bot de fluxos:** editor visual (menus, perguntas, condições, horário de atendimento, requisições HTTP, transferência) com simulador e publicação por versões.
- **Assistentes de IA:** respostas com Claude a partir das suas instruções e base de conhecimento, com transferência para a equipe quando não souber responder.
- **API v1** documentada (Swagger), com chaves de API por integração. As rotas originais do MyZap (`/sendText`, `/start`...) continuam funcionando.
- **Webhooks** assinados, com reenvio automático e histórico de entregas.
- Histórico completo em banco (SQLite), sessões que reconectam sozinhas, métricas Prometheus e backup.

## Começando (Docker)

```bash
git clone https://github.com/FabioRochaHelp/chatbot.git
cd chatbot
cp .env_example .env      # defina ao menos ADMIN_EMAIL e ADMIN_PASSWORD
docker compose up -d --build
```

1. Abra `http://localhost:3333` e entre com o `ADMIN_EMAIL`/`ADMIN_PASSWORD` do `.env`. Sem eles, o painel pede para criar o administrador no primeiro acesso.
2. Em **Sessões → Nova sessão**, dê um nome (ex.: `loja`) e leia o QR code com o celular: *WhatsApp → Configurações → Aparelhos conectados → Conectar um aparelho*. O QR code expira em cerca de 1 minuto; se a sessão fechar, é só iniciar de novo.
3. Pronto: as mensagens recebidas aparecem em **Atendimento**. Para respostas automáticas, crie um **Fluxo** ou um **Assistente de IA** e ligue em *Sessões → sessão → Bot*.

Dados ficam em dois volumes (os nomes vêm de quando o projeto se chamava MyZap e foram mantidos para não perder dados): `myzap_tokens` (login do WhatsApp; reiniciar não pede QR de novo) e `myzap_data` (banco SQLite, mídias, segredo do login). As migrations do banco rodam sozinhas ao iniciar.

- Logs: `docker compose logs -f conectzap` (ou `make logs`)
- Desenvolvimento com hot-reload no container: `docker compose --profile dev up --build conectzap-dev`

## Configuração (`.env`)

| Variável | Padrão | Para que serve |
|---|---|---|
| `PORT` | `3333` | Porta HTTP. |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | — | Cria o primeiro administrador no boot (só se ainda não houver usuários). |
| `API_TOKEN` | — | Token mestre para integrações antigas (`Authorization: Bearer <token>`). Para integrações novas, prefira chaves de API criadas no painel. |
| `ANTHROPIC_API_KEY` | — | Chave da API da Anthropic (platform.claude.com) para os assistentes de IA. Sem ela a IA fica desligada. |
| `TIMEZONE` | `America/Sao_Paulo` | Fuso usado pela IA para saber a data e a hora. |
| `JWT_SECRET` | gerado | Segredo do login do painel. Sem ele, um segredo aleatório é salvo em `DATA_DIR/jwt-secret`. |
| `SESSION_TTL_HOURS` | `168` | Duração do login do painel. |
| `COOKIE_SECURE` | igual a `HTTPS` | Use `1` atrás de um proxy com HTTPS. |
| `CORS_ORIGINS` | qualquer | Origens liberadas, separadas por vírgula. |
| `RATE_LIMIT_PER_MINUTE` | `600` | Requisições por minuto por IP (`0` desliga). |
| `TRUST_PROXY` | — | `1` atrás de nginx/traefik, para o limite enxergar o IP real. |
| `DATA_DIR` | `./data` | Banco, mídias e backups. |
| `DATABASE_URL` | `file:DATA_DIR/conectzap.db` | Caminho do SQLite. |
| `DB_MIGRATE` | `1` | `0` desliga as migrations automáticas ao iniciar. |
| `MEDIA_MAX_MB` | `50` | Tamanho máximo de mídia recebida que é baixada. |
| `TOKENS_DIR` | `./tokens` | Login das sessões do WhatsApp. |
| `CHROME_PATH` | — | Caminho do Chromium (no Docker já vem configurado). |
| `ENGINE` | `WPPCONNECT` | `VENOM` está obsoleto (venom-bot sem atualizações desde 11/2024 e sem gerar QR code em testes de 10/2026). |
| `LOG_LEVEL` | `info` | `trace`, `debug`, `info`, `warn`, `error` ou `silent`. Logs em JSON. |
| `HTTPS`, `SSL_KEY_PATH`, `SSL_CERT_PATH` | — | HTTPS direto no Node (prefira um proxy reverso; veja abaixo). |

## Painel

| Área | O que faz | Quem vê |
|---|---|---|
| Painel | Sessões conectadas, fila, conversas em atendimento, não lidas e mensagens dos últimos 7 dias. | Todos |
| Atendimento | Filas *Fila*, *Minhas*, *Abertas* e *Encerradas*. Assumir, transferir, devolver à fila ou ao bot, encerrar e reabrir. Notas internas, `/atalho` para respostas rápidas, anexos, etiquetas e notificação do navegador. | Todos |
| Sessões | Criar, conectar pelo QR code (atualiza ao vivo), reconectar, fechar e escolher o bot. Atendentes só consultam. | Todos |
| Fluxos | Editor visual, simulador com o rascunho, validação e publicação por versões. | Administradores |
| Assistentes de IA | Instruções, base de conhecimento, modelo, estilo de resposta, limites, playground e custo dos últimos 30 dias. | Administradores |
| Enviar mensagem | Teste de envio pela API com o `curl` equivalente. | Administradores |
| Webhooks | Cadastro, segredo da assinatura, envio de teste e histórico de entregas com reenvio. | Administradores |
| Configurações | Usuários (administradores e atendentes), respostas rápidas, chaves de API e troca de senha. | Administradores (Minha conta: todos) |

Como as conversas andam:

- Com o bot desligado (padrão), toda conversa nova entra na **Fila**. Com bot ligado, começa **com o bot** e vai para a fila quando o fluxo ou a IA transfere, quando o cliente escreve "atendente"/"humano" (configurável no fluxo) ou se algo der errado.
- O bot e a IA só respondem conversas *com o bot*. Assumir uma conversa os faz parar.
- **Grupos:** o bot nunca responde grupos. Por padrão as mensagens de grupo são ignoradas (não entram no Atendimento). Para atender grupos com a equipe, ligue *Sessões → sessão → Grupos no Atendimento*; desligar encerra as conversas de grupo abertas (o histórico fica). Canais do WhatsApp são sempre ignorados.
- **Fotos de perfil:** baixadas quando o contato manda mensagem (no máximo uma vez por dia) e guardadas em `DATA_DIR/media/avatars`, porque os links do WhatsApp expiram. Contatos com foto privada ficam com as iniciais. Em grupos, o nome do grupo também vem do WhatsApp.
- Responder pelo painel assume a conversa. Responder uma conversa encerrada a reabre.

### Bot de fluxos

Blocos: mensagem, menu numerado, pergunta (qualquer texto, número, e-mail ou telefone), condição, horário de atendimento, aguardar, requisição HTTP, etiqueta, IA, transferir e fim. Nas mensagens, use `{{contact.name}}`, `{{contact.number}}` e as respostas guardadas (`{{pedido}}`, `{{resposta.campo}}`).

- **Testar** abre um simulador com o rascunho atual, sem WhatsApp. **Publicar** valida o fluxo e cria uma versão; as sessões só usam a versão publicada.
- Após 3 respostas inválidas num menu, transfere (ou segue a saída "Não entendeu"). Após 30 min sem resposta (configurável), o fluxo recomeça.

### Assistentes de IA

- O assistente responde com base nas **instruções** e na **base de conhecimento** e não inventa o que não está lá: nesses casos, e em reclamações, negociações e pagamentos, transfere para a fila e deixa o motivo como nota interna.
- Modelo padrão **Claude Opus 5**. Claude Sonnet 5 e Claude Haiku 4.5 são opções mais baratas, escolhidas por assistente.
- Ligue de duas formas: na sessão (a IA atende tudo) ou com o bloco **IA** num fluxo (ex.: a opção "Outros assuntos" de um menu).
- Sem `ANTHROPIC_API_KEY`, acima do limite de respostas por hora ou se a API falhar, a conversa vai para a fila.
- As instruções e a base de conhecimento ficam em cache entre as mensagens (mais barato em conversas longas). Com o Opus 5, se o modelo recusar uma resposta por segurança, a API tenta um modelo de reserva na mesma chamada.

## API

- **Documentação interativa:** `http://localhost:3333/api/docs` (Swagger) e `/api/openapi.json` (OpenAPI 3.1).
- **Autenticação:** `Authorization: Bearer <chave>` com uma chave de API (`czk_...`, criada em *Configurações → Chaves de API*; chaves antigas `mzk_` continuam valendo) ou o `API_TOKEN`. O painel usa cookie de login.
- **Papéis:** administrador (tudo), atendente (conversas e contatos) e integração (chave de API: tudo menos usuários e chaves).
- **Respostas:** sucesso em `{ "data": ... }` (listas com `meta`); erro em `{ "error": { "code", "message", "details" } }` com o status HTTP: 400 parâmetro inválido, 401, 403, 404, 409 sessão desconectada, 502 falha no WhatsApp.

```bash
curl -X POST http://localhost:3333/api/v1/sessions/loja/messages \
  -H "Authorization: Bearer $CONECTZAP_API_KEY" -H "Content-Type: application/json" \
  -d '{"to": "5511999999999", "type": "text", "text": "Olá!"}'
```

Tipos de mensagem: `text`, `file` (`base64` + `fileName`), `voice`, `location` (`lat`, `lng`), `link` e `contact`. O destino aceita número com DDI (com ou sem máscara) ou o id do WhatsApp (`...@c.us`, `...@g.us`).

Sem `API_TOKEN`, usuários ou chaves, a API fica aberta como nas versões antigas (com aviso no log). Criar o primeiro usuário ou chave fecha a API.

### Rotas antigas (compatibilidade)

Continuam com o formato `{ "result": "success" | "error", "message" }`. Parâmetros inválidos agora respondem **HTTP 400** com `message: "INVALID_PARAMS"`.

| Rota | Parâmetros |
|---|---|
| `GET /start` · `/status` · `/close` | `sessionName` |
| `GET /qrcode` | `sessionName`, `image=true` para PNG |
| `POST /sendText` | `sessionName`, `number`, `text` |
| `POST /sendFile` · `/sendImageStorie` | `sessionName`, `number`, `base64Data`, `fileName`, `caption` |
| `POST /sendVoice` · `/sendLocation` · `/sendLink` · `/sendContactVcard` · `/sendTextToStorie` | ver `/api/docs` e `server/schemas.js` |
| `GET /getAllChatsNewMsg` · `/getAllUnreadMessages` · `/checkNumberStatus` · `/getNumberProfile` | `sessionName` (e `number`) |
| `POST /sendHook` | `sessionName`, `hook` (URL que recebe as mensagens no formato antigo) |

Mensagens enviadas por essas rotas também ficam no histórico e aparecem no Atendimento.

## Webhooks

Cadastre em **Webhooks** (ou `POST /api/v1/webhooks`). Para cada evento escolhido, o ConectZap envia um `POST` com JSON:

```json
{ "id": 42, "event": "message.received", "createdAt": "2026-10-06T14:32:00.000Z",
  "data": { "session": "loja", "message": { ... }, "conversation": { "id": 7, "status": "pending" }, "contact": { "waId": "5511999999999@c.us", "pushName": "Maria" } } }
```

| Evento | Quando |
|---|---|
| `message.received` | Mensagem recebida de um contato. |
| `message.sent` | Mensagem enviada pela API, bot, IA, atendente ou pelo celular. |
| `conversation.updated` | Conversa mudou de status ou de atendente. |
| `conversation.handoff` | Bot ou IA transferiu para a fila (com o motivo). |
| `session.state` | A sessão conectou, caiu ou pediu QR code. |

- **Assinatura:** cada envio traz `X-ConectZap-Timestamp` e `X-ConectZap-Signature: sha256=<HMAC-SHA256 de "timestamp.corpo" com o segredo>`. Confira com o corpo bruto e recuse timestamps antigos. A tela do webhook tem o segredo e um exemplo em Node.js.
- **Reenvio:** respostas fora de 2xx ou falhas de rede são reenviadas com espera crescente (10 s, 1 min, 5 min, 30 min, 2 h, 6 h), até 7 tentativas. Cada entrega pode ser reenviada à mão. O histórico guarda 7 dias.
- Webhooks antigos de `/sendHook` continuam recebendo a mensagem original do WhatsApp, sem assinatura. Eles aparecem na lista e podem ser pausados ou removidos.

## Tempo real

Socket.IO em `/socket.io`, autenticado pelo cookie do painel ou por `auth: { token: "<chave de API>" }`. Eventos: `sessions` (estado inicial), `session.state`, `session.qrcode` (só administradores e integrações), `message.saved`, `message.updated`, `conversation.updated`, `conversations.changed` e `contact.updated`.

## Métricas

`GET /metrics` no formato Prometheus, com chave de API ou login de administrador:

```yaml
scrape_configs:
  - job_name: conectzap
    metrics_path: /metrics
    bearer_token: czk_...   # chave de API criada no painel
    static_configs: [{ targets: ['conectzap:3333'] }]
```

Inclui sessões por estado, conversas por status, mensagens por direção e origem, transferências por motivo, fila e resultado dos webhooks, chamadas, tokens e tempo de resposta da IA, duração das requisições HTTP por rota e métricas do processo Node.

## Backup

```bash
npm run db:backup                            # fora do Docker
docker compose exec conectzap npm run db:backup  # no Docker
```

Cria uma cópia consistente do banco (mesmo com o servidor rodando) em `DATA_DIR/backups/` e mantém as 14 mais recentes (`-- --keep 30` para mudar). Para restaurar, pare o ConectZap e troque o arquivo do banco em `DATA_DIR` (`conectzap.db`, ou `myzap.db` em instalações antigas) pelo backup. As mídias ficam em `DATA_DIR/media` e o login do WhatsApp no volume de tokens: inclua os dois no backup do servidor.

O banco é SQLite, suficiente para uma instância com algumas sessões. Outros bancos (como PostgreSQL) ainda não são suportados: exigiriam trocar o `provider` em `prisma/schema.prisma`, o adapter em `server/db.js` e gerar migrations novas.

## Instalação sem Docker

```bash
sudo apt install -y curl git chromium fonts-liberation ca-certificates
curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash - && sudo apt install -y nodejs   # Node 22.12+ (24 LTS recomendado)
git clone https://github.com/FabioRochaHelp/chatbot.git && cd chatbot
PUPPETEER_SKIP_DOWNLOAD=true npm install
npm run web:install && npm run build          # painel
cp .env_example .env                          # CHROME_PATH=/usr/bin/chromium
npm start
```

Para manter rodando após reiniciar o servidor: `npm install -g pm2 && pm2 start index.js --name conectzap && pm2 startup`.

## HTTPS

O recomendado é um proxy reverso (nginx, Caddy, Traefik) com HTTPS na frente do ConectZap. Configure `TRUST_PROXY=1` e `COOKIE_SECURE=1` e encaminhe o WebSocket de `/socket.io`. No nginx:

```nginx
location / {
    proxy_pass http://127.0.0.1:3333;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

Também dá para servir HTTPS direto com `HTTPS=1`, `SSL_KEY_PATH` e `SSL_CERT_PATH` (por exemplo, certificados do certbot).

## Desenvolvimento

```
server/             backend Node.js (Express, CommonJS)
  index.js          bootstrap: migrations, HTTP, tempo real, webhooks, shutdown
  app.js            createApp(): rotas, painel e segurança (usado nos testes)
  sessions.js       ciclo de vida das sessões do WhatsApp
  engine/           adapters wppconnect / venom
  history.js        gravação de contatos, conversas, mensagens e mídias
  messaging.js      envio de mensagens (rotas antigas e v1)
  pipeline/         bot: fluxos (flows.js), IA (ai.js) e decisão (index.js)
  routes/legacy.js  rotas antigas
  routes/v1/        API v1 (gera o OpenAPI a partir dos schemas zod)
  webhooks.js       fila e envio de webhooks
  realtime.js       Socket.IO
  metrics.js        Prometheus
prisma/             schema e migrations (SQLite)
web/                painel (React + Vite + TypeScript + Tailwind), package.json próprio
test/               testes (vitest + supertest; sem navegador nem WhatsApp)
scripts/            backup do banco
```

- `make` lista atalhos para os comandos abaixo e para o Docker (`make up`, `make logs`, `make backup`, `make check`...).
- API com hot-reload: `npm run dev`. Painel: `npm run web:dev` (porta 5173, repassa `/api` e `/socket.io` para a 3333).
- `npm run check` roda o que o CI roda: lint, formatação, testes e lint/typecheck do painel.
- Depois de alterar `prisma/schema.prisma`: `npm run db:migrate -- --name <nome>`. Para ver o banco: `npm run db:studio`.

## Mudanças em relação ao MyZap original

- Requer Node.js 22.12 ou superior (a imagem Docker usa Node 24).
- O endpoint `POST /exec`, que executava comandos de shell no servidor, foi removido por segurança.
- Parâmetros inválidos respondem HTTP 400 (antes respondiam 200 e, por exemplo, criavam uma sessão chamada `undefined`). Nomes de sessão aceitam só letras, números, `.`, `-` e `_`.
- A API passa a exigir autenticação assim que existir um usuário ou uma chave de API. `?token=` ainda funciona para o `API_TOKEN`, mas está obsoleto.
- Limite padrão de 600 requisições por minuto por IP.
- O salvamento do token no jsonbin.io foi removido (não funciona com o WhatsApp multidevice). As sessões ficam no volume de tokens.
- A resposta automática de demonstração `TESTEBOT` foi removida: use um fluxo ou um assistente de IA.
- `ENGINE=VENOM` continua disponível, mas obsoleto.

## Créditos

O ConectZap nasceu do [MyZap](https://github.com/billbarsch/myzap), de Bill Barsch: a API original, as rotas compatíveis e a integração com o WhatsApp Web vêm de lá. Comunidade do projeto original: [vídeo explicativo](https://www.youtube.com/watch?v=blOpjAS1Fik) e [grupo no WhatsApp](https://chat.whatsapp.com/DMehlYDcMWiKmlIsOLGAQM).

Para quem vem do MyZap: os volumes do Docker (`myzap_tokens`, `myzap_data`), o banco `myzap.db` e as chaves de API `mzk_` continuam funcionando. Mudaram os cabeçalhos dos webhooks (`X-ConectZap-*`), o prefixo das métricas (`conectzap_*`), o nome do serviço no Docker (`conectzap`) e o cookie do painel (é preciso entrar de novo uma vez).
