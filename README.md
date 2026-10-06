# MyZap - Free Open Source Whatsapp Api

[![Video explicativo do projeto](https://img.youtube.com/vi/blOpjAS1Fik/0.jpg)](https://www.youtube.com/watch?v=blOpjAS1Fik)


[Grupo do Whatsapp: Link para o nosso grupo para tirar dúvidas e nos ajudarmos (clique aqui)](https://chat.whatsapp.com/DMehlYDcMWiKmlIsOLGAQM)



Este projeto usa como base o [Venom-bot](https://github.com/orkestral/venom) ou o [WPPCONNECT](https://github.com/wppconnect-team/wppconnect), um navegador virtual sem interface gráfica que abre o whatsapp web e executa todos os comandos via código possibilitando assim a automação de todas as funções.

## Docker (recomendado)

A imagem (`node:24-bookworm-slim` + Chromium do Debian) já traz todas as dependências de sistema.

```bash
git clone https://github.com/billbarsch/myzap.git
cd myzap
cp .env_example .env      # ajuste ENGINE, API_TOKEN etc.
docker compose up -d --build
```

- A API sobe em `http://localhost:3333` (troque a porta do host com `PORT` no `.env`).
- As sessões ficam no volume `myzap_tokens`, então reiniciar o container não exige ler o QR code de novo.
- Sessões e webhooks ficam salvos em SQLite no volume `myzap_data` (as migrations rodam sozinhas ao iniciar). Uma sessão iniciada com `/start` volta sozinha quando o servidor reinicia; `/close` desliga esse retorno.
- Variáveis do `.env`:
  - `ENGINE=WPPCONNECT` (padrão) ou `ENGINE=VENOM`. Obs.: o venom-bot não tem releases desde 11/2024 e, em testes de 10/2026, abre o WhatsApp Web mas não gera o QR code. Prefira o WPPCONNECT.
  - `API_TOKEN=<segredo>`: protege todas as rotas (exceto `/`). Envie `Authorization: Bearer <segredo>` ou `?token=<segredo>`.
  - `LOG_LEVEL` (padrão `info`): os logs saem em JSON (pino). Em terminal de desenvolvimento saem formatados.
  - `CORS_ORIGINS`: origens liberadas, separadas por vírgula (vazio libera qualquer origem).
  - `RATE_LIMIT_PER_MINUTE` (padrão `600` por IP, `0` desativa) e `TRUST_PROXY=1` quando estiver atrás de nginx/traefik.
- Desenvolvimento com hot-reload (código montado no container): `docker compose --profile dev up --build myzap-dev`
- Logs: `docker compose logs -f myzap`

> O endpoint `POST /exec`, que executava comandos de shell no servidor, foi removido por segurança.

> Os parâmetros são validados. Uma requisição inválida (sessão sem `sessionName`, nome com `/` ou `..`, número que não é telefone, URL inválida) responde **HTTP 400** com `{ "result": "error", "message": "INVALID_PARAMS", "errors": [...] }`. O `number` aceita máscara (`+55 (63) 3414-0378`) ou o id completo (`...@c.us`, `...@g.us`).

## Desenvolvimento

```
server/
  index.js          bootstrap (http/https, shutdown)
  app.js            createApp(): Express sem listen (usado nos testes)
  http.js           segurança (helmet, cors, rate limit), auth, validação, erros
  schemas.js        schemas zod das rotas
  routes/legacy.js  rotas da API
  sessions.js       ciclo de vida das sessões do WhatsApp
  engine/           adapters wppconnect / venom
test/               testes (vitest + supertest, sem navegador)
web/                painel React (build em web/dist, servido pelo Express)
```

- `npm run db:migrate -- --name <nome>` cria uma migration depois de alterar `prisma/schema.prisma`; `npm run db:studio` abre o banco no navegador.
- `npm test` · `npm run lint` · `npm run format` · `npm run check` (tudo o que o CI roda, inclusive lint e typecheck do painel)
- O painel fica em `web/` (React + Vite + TypeScript + Tailwind), com `package.json` próprio.

## Painel

Abra `http://localhost:3333` no navegador. No primeiro acesso o painel pede para criar o administrador.

- **Painel:** sessões conectadas, conversas aguardando atendente, não lidas e mensagens dos últimos 7 dias.
- **Sessões:** criar, conectar lendo o QR code (atualiza ao vivo), reconectar e fechar.
- **Enviar mensagem:** teste de envio (texto, arquivo, localização, link) com o `curl` equivalente para a sua integração.
- Tema claro/escuro e layout para celular.

A imagem Docker já traz o painel compilado. Fora do Docker: `npm run web:install && npm run build`.
Para desenvolver o painel com hot-reload: `npm run dev` (API na 3333) e, em outro terminal, `npm run web:dev` (abre na 5173, repassando `/api` e `/socket.io` para a 3333).

## Usuários, chaves de API e tempo real

- **Primeiro acesso:** defina `ADMIN_EMAIL` e `ADMIN_PASSWORD` no `.env` (o admin é criado no boot se não houver usuários) ou chame `POST /api/v1/auth/setup` com `{ "email", "name", "password" }`. Se `API_TOKEN` estiver definido, o setup exige esse token.
- **Papéis:** `admin` (tudo), `agent` (atendente: conversas e contatos; não conecta sessões, não envia avulso e não usa as rotas antigas). Chaves de API (`mzk_...`, criadas em `POST /api/v1/api-keys`) servem para integrações e não gerenciam usuários.
- **Quando a API exige autenticação:** se houver `API_TOKEN`, algum usuário ou alguma chave de API. Sem nada disso ela continua aberta como nas versões antigas (com aviso no log).
- **Login do painel:** `POST /api/v1/auth/login` grava um cookie `httpOnly` e `SameSite=Strict`. Atrás de um proxy com HTTPS, use `COOKIE_SECURE=1`. Trocar a senha, mudar o papel ou desativar o usuário encerra os logins ativos.
- **Tempo real:** Socket.IO em `/socket.io` (cookie do painel ou `auth: { token }` com a chave de API). Eventos: `sessions` (estado inicial), `session.state`, `session.qrcode` (só admin/integração), `message.saved`, `conversation.updated`, `contact.updated`.

## API v1 e documentação

- **Documentação interativa:** `http://localhost:3333/api/docs` (Swagger). A especificação OpenAPI 3.1 fica em `/api/openapi.json`. Clique em *Authorize* e informe uma chave de API ou o `API_TOKEN`.
- Rotas em `/api/v1`: sessões (criar, iniciar, fechar, QR code), envio de mensagens (`text`, `file`, `voice`, `location`, `link`, `contact`), conversas, contatos e mídias.
- Sucesso: `{ "data": ... }` (listas: `{ "data": [...], "meta": { "total", "limit", "offset" } }`). Erro: `{ "error": { "code", "message", "details" } }` com o status HTTP correspondente (400, 401, 404, 409 sessão desconectada, 502 falha no WhatsApp).
- **Histórico:** toda mensagem recebida ou enviada (pela API, pelas rotas antigas ou pelo próprio celular) fica gravada com contato e conversa. As mídias recebidas são baixadas para `DATA_DIR/media` (limite `MEDIA_MAX_MB`, padrão 50).

```bash
curl -X POST http://localhost:3333/api/v1/sessions/session1/messages \
  -H "Authorization: Bearer $API_TOKEN" -H "Content-Type: application/json" \
  -d '{"to": "556334140378", "type": "text", "text": "Olá!"}'
```

As rotas antigas abaixo (`/start`, `/sendText`...) continuam funcionando como antes.

## Setup manual (sem Docker)

`sudo apt install -y curl git chromium fonts-liberation ca-certificates`
- o pacote `chromium` instala as bibliotecas de sistema necessárias (libnss3, libgbm, libgtk-3...)

`curl -fsSL https://deb.nodesource.com/setup_24.x | sudo -E bash -`

`sudo apt install -y nodejs`
- Node.js 22 ou superior (24 LTS recomendado)

`git clone https://github.com/billbarsch/myzap.git`

`cd myzap`

`PUPPETEER_SKIP_DOWNLOAD=true npm install`

`cp .env_example .env`
```
Dentro do arquivo .env:
Para usar o venom como motor use a variavel:
ENGINE=VENOM
Para usar o WPPCONNECT como motor use a variavel:
ENGINE=WPPCONNECT
Caminho do navegador:
CHROME_PATH=/usr/bin/chromium
```

### Start server

`npm start`

### keep processes alive at every server restart

`npm install -y pm2 -g`

`pm2 start index.js`

`pm2 startup`

## Usage

### Start new whatsapp session

`http://localhost:3333/start?sessionName=session1`

### Get QRCode (quickly!!)

`http://localhost:3333/qrcode?sessionName=session1&image=true`
- png

`http://localhost:3333/qrcode?sessionName=session1`
- json (base64)

### Send message (POST method)

```javascript
(async () => {
  const response = await fetch('http://localhost:3333/sendText', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(
        {
            sessionName: "session1", 
            number: '556334140378',
            text:"Hello\nWorld"
        }
    )
  });
  const content = await response.json();

  console.log(content);
})();  
```

### Send File (POST method)

```javascript
(async () => {
    const response = await fetch('http://localhost:3333/sendFile', {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(
        {
            sessionName: "session1", 
            number: '556334140378',
            base64Data:"44696d61", //hexadecimal
            fileName:"test.txt",
            caption: "Document" //optional
        }
    )
  });
  const content = await response.json();

  console.log(content);
})();  
```

### Close whatsapp session

`http://localhost:3333/close?sessionName=session1`


## Salvar token do venom na nuvem (jsonbin.io) (opcional)
 - Crie uma conta grátis no https://jsonbin.io/ 
 - Crie um novo "bin" (objeto json) com quaisquer dados e copie o id dele e coloque no arquivo .env
 - Copie também a sua "X-Master-Key" da api v3 do jsonbin.io e coloque no arquivo .env
 - Obs.: o venom-bot 5 e o login multidevice não expõem mais o token do navegador. Nesses casos o token não é salvo na nuvem; prefira manter o volume `tokens` persistente.

```
...
JSONBINIO_BIN_ID=23452345345 <- deixar em branco caso não queira usar essa opção do jsonbin.io 
JSONBINIO_SECRET_KEY=345234532452452345243 <- deixar em branco caso não queira usar essa opção do jsonbin.io
...
```

 - com esses dados o myzap irá gravar o token na nuvem e poderá ser executado em várias instancias diferentes por exemplo no Gooogle Cloud Run

## To install certbot and create ssl certificate to https domains:

`sudo apt-get update && sudo apt-get install -y software-properties-common`

`sudo add-apt-repository universe && sudo add-apt-repository ppa:certbot/certbot`

`sudo apt-get update && sudo apt-get install -y certbot`

`sudo certbot certonly --manual --force-renewal -d *.yourdomain.net -d yourdomain.net --agree-tos --no-bootstrap --manual-public-ip-logging-ok --preferred-challenges dns-01 --server https://acme-v02.api.letsencrypt.org/directory`
