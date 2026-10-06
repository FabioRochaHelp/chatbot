# MyZap - Free Open Source Whatsapp Api

[![Video explicativo do projeto](https://img.youtube.com/vi/blOpjAS1Fik/0.jpg)](https://www.youtube.com/watch?v=blOpjAS1Fik)


[Grupo do Whatsapp: Link para o nosso grupo para tirar dúvidas e nos ajudarmos (clique aqui)](https://chat.whatsapp.com/DMehlYDcMWiKmlIsOLGAQM)



Este projeto usa como base o [Venom-bot](https://github.com/orkestral/venom) ou o [WPPCONNECT](https://github.com/wppconnect-team/wppconnect), um navegador virtual sem interface gráfica que abre o whatsapp web e executa todos os comandos via código possibilitando assim a automação de todas as funções.

## Docker (recomendado)

A imagem (`node:20-bookworm-slim` + Chromium do Debian) já traz todas as dependências de sistema.

```bash
git clone https://github.com/billbarsch/myzap.git
cd myzap
cp .env_example .env      # ajuste ENGINE, API_TOKEN etc.
docker compose up -d --build
```

- A API sobe em `http://localhost:3333` (troque a porta do host com `PORT` no `.env`).
- As sessões ficam no volume `myzap_tokens`, então reiniciar o container não exige ler o QR code de novo.
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
```

- `npm test` · `npm run lint` · `npm run format` · `npm run check` (tudo o que o CI roda)

## Setup manual (sem Docker)

`sudo apt install -y curl git chromium fonts-liberation ca-certificates`
- o pacote `chromium` instala as bibliotecas de sistema necessárias (libnss3, libgbm, libgtk-3...)

`curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -`

`sudo apt install -y nodejs`
- Node.js 20 ou superior

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
