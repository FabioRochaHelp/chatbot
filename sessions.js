'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('./config');

// carrega só a engine configurada (cada uma puxa o seu puppeteer)
const engineLib = config.engine === 'VENOM' ? require('venom-bot') : require('@wppconnect-team/wppconnect');

const BROWSER_ARGS = [
    '--log-level=3',
    '--no-default-browser-check',
    '--disable-site-isolation-trials',
    '--no-experiments',
    '--ignore-gpu-blacklist',
    '--ignore-certificate-errors',
    '--ignore-certificate-errors-spki-list',
    '--disable-gpu',
    '--disable-extensions',
    '--disable-default-apps',
    '--enable-features=NetworkService',
    '--disable-setuid-sandbox',
    '--no-sandbox',
    '--no-zygote',
    '--disable-dev-shm-usage',
    // Extras
    '--disable-webgl',
    '--disable-threaded-animation',
    '--disable-threaded-scrolling',
    '--disable-in-process-stack-traces',
    '--disable-histogram-customizer',
    '--disable-gl-extensions',
    '--disable-composited-antialiasing',
    '--disable-canvas-aa',
    '--disable-3d-apis',
    '--disable-accelerated-2d-canvas',
    '--disable-accelerated-jpeg-decoding',
    '--disable-accelerated-mjpeg-decode',
    '--disable-app-list-dismiss-on-blur',
    '--disable-accelerated-video-decode',
];

// o shutdown (SIGTERM/SIGINT) é feito pelo index.js, que fecha as sessões em ordem
// (o puppeteer continua matando o navegador no evento 'exit' do processo)
const PUPPETEER_SIGNALS = { handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false };
const CLOSE_TIMEOUT = 5000;

// API v3 do jsonbin.io (a v2 "/b/<id>" + "secret-key" foi descontinuada)
const jsonbin = {
    url: () => 'https://api.jsonbin.io/v3/b/' + config.jsonbinio.binId,
    headers: () => ({ 'Content-Type': 'application/json', 'X-Master-Key': config.jsonbinio.secretKey }),
    async get() {
        const response = await axios.get(jsonbin.url() + '/latest', { headers: jsonbin.headers() });
        return response.data.record;
    },
    async put(data) {
        const response = await axios.put(jsonbin.url(), data, { headers: jsonbin.headers() });
        return response.data;
    }
};

function chatId(number) {
    return number + '@c.us';
}

module.exports = class Sessions {

    static async start(sessionName) {
        Sessions.sessions = Sessions.sessions || []; //start array

        var session = Sessions.getSession(sessionName);

        if (session == false) { //create new session
            console.log("session == false");
            session = await Sessions.addSesssion(sessionName);
        } else if (["CLOSED"].includes(session.state)) { //restart session
            console.log("session.state == CLOSED");
            session.state = "STARTING";
            session.status = 'notLogged';
            Sessions.launch(session);
        } else if (["CONFLICT", "UNPAIRED", "UNLAUNCHED"].includes(session.state)) {
            console.log("client.useHere()");
            session.client.then(client => client.useHere()).catch(error => console.log(error.message));
        } else {
            console.log("session.state: " + session.state);
        }
        return session;
    } //start

    static async getStatus(sessionName) {
        Sessions.sessions = Sessions.sessions || [];
        return Sessions.getSession(sessionName);
    } //getStatus

    static async addSesssion(sessionName) {
        var newSession = {
            name: sessionName,
            hook: null,
            qrcode: false,
            client: false,
            status: 'notLogged',
            state: 'STARTING'
        }
        Sessions.sessions.push(newSession);
        console.log("newSession.state: " + newSession.state);

        Sessions.launch(newSession);

        return newSession;
    } //addSession

    static launch(session) {
        session.generation = (session.generation || 0) + 1;
        const generation = session.generation;
        session.client = Sessions.initSession(session.name, generation);
        // se o navegador não subir, marca como CLOSED para que /start tente de novo
        session.client.catch(error => {
            console.log("initSession(" + session.name + "):", (error && error.message) || error);
            if (session.generation === generation) {
                session.state = "CLOSED";
                session.client = false;
            }
        });
        Sessions.setup(session.name);
    } //launch

    static async initSession(sessionName, generation) {
        var session = Sessions.getSession(sessionName);
        session.browserSessionToken = null;
        if (config.jsonbinio) {//se informou secret key pra salvar na nuvem
            //busca token da session na nuvem
            try {
                const record = await jsonbin.get();
                if (record && record.WAToken1 !== undefined) {
                    session.browserSessionToken = record;
                    console.log("token carregado da nuvem");
                } else {
                    console.log("nao tinha token na nuvem");
                }
            } catch (error) {
                console.log("jsonbin.io: " + error.message);
            }
        }//if jsonbinio

        const catchQR = (base64Qrimg, asciiQR, attempts, urlCode) => {
            if (session.generation !== generation) return;
            session.state = "QRCODE";
            session.qrcode = base64Qrimg;
            session.CodeasciiQR = asciiQR;
            session.CodeurlCode = urlCode;
        };
        const statusFind = (statusSession, name) => {
            console.log('#### status=' + statusSession + ' sessionName=' + name);
        };
        const common = {
            session: session.name,
            catchQR: catchQR,
            statusFind: statusFind,
            folderNameToken: config.tokensDir,
            headless: config.engine === 'VENOM' ? 'new' : true,
            devtools: false,
            debug: false,
            logQR: true,
            browserArgs: BROWSER_ARGS,
            disableWelcome: true,
            updatesLog: true,
            autoClose: 60000,
            createPathFileToken: true,
            waitForLogin: true
        };

        // session.browser guarda o navegador para que closeSession() consiga fechá-lo
        // mesmo antes do login (o create() só resolve depois que o QR é lido)
        var client;
        if (config.engine === 'VENOM') {
            client = await engineLib.create({
                ...common,
                browserPathExecutable: config.chromePath,
                BrowserFetcher: false,
                puppeteerOptions: PUPPETEER_SIGNALS,
                disableSpins: true,
                browserInstance: browser => { session.browser = browser; }
            });
        } else {
            // mesmo launcher do wppconnect (puppeteer-extra + stealth), chamado aqui para guardar o browser
            const { initBrowser } = require('@wppconnect-team/wppconnect/dist/controllers/browser');
            session.browser = await initBrowser(session.name, {
                headless: common.headless,
                devtools: false,
                useChrome: false,
                browserArgs: BROWSER_ARGS,
                puppeteerOptions: {
                    executablePath: config.chromePath,
                    userDataDir: path.join(config.tokensDir, session.name),
                    ...PUPPETEER_SIGNALS
                }
            }, engineLib.defaultLogger);
            client = await engineLib.create({
                ...common,
                browser: session.browser,
                sessionToken: session.browserSessionToken || undefined
            });
        }
        if (session.generation !== generation) { // fechada (ou reiniciada) antes do login
            await client.close().catch(() => null);
            throw new Error('sessão fechada antes de conectar');
        }
        session.state = "CONNECTED";
        return client;
    } //initSession

    static async setup(sessionName) {
        var session = Sessions.getSession(sessionName);
        const generation = session.generation;
        var client;
        try {
            client = await session.client;
        } catch (error) {
            return; // já tratado em launch()
        }

        client.onStateChange(state => {
            if (session.generation !== generation) return;
            session.state = state;
            if (state == "CONNECTED" && config.jsonbinio && session.browserSessionToken == undefined) {
                //salva dados do token da sessão na nuvem
                setTimeout(() => Sessions.saveCloudToken(client), 2000);
            }
            console.log("session.state: " + state);
        });
        client.onMessage(async (message) => {
            var session = Sessions.getSession(sessionName);
            if (session.hook != null) {
                await axios.post(session.hook, message, { headers: { 'Content-Type': 'application/json' } })
                    .then(function (response) {
                        console.log(JSON.stringify(response.data));
                    })
                    .catch(function (error) {
                        console.log("hook: " + error.message);
                    });
            } else if (message.body == "TESTEBOT") {
                client.sendText(message.from, 'Hello\nfriend!');
            }
        });
    } //setup

    static async saveCloudToken(client) {
        // o venom 5 (e o login multidevice) não expõe mais o token do navegador
        if (typeof client.getSessionTokenBrowser !== 'function') {
            console.log("engine sem getSessionTokenBrowser: token não será salvo na nuvem");
            return;
        }
        try {
            console.log("gravando token na nuvem...");
            const browserSessionToken = await client.getSessionTokenBrowser();
            console.log(JSON.stringify(await jsonbin.put(browserSessionToken)));
        } catch (error) {
            console.log("jsonbin.io: " + error.message);
        }
    } //saveCloudToken

    static async clearCloudToken() {
        if (!config.jsonbinio) return;
        try {
            console.log("limpando token na nuvem...");
            console.log(JSON.stringify(await jsonbin.put({ "nada": "nada" })));
        } catch (error) {
            console.log("jsonbin.io: " + error.message);
        }
    } //clearCloudToken

    static async closeSession(sessionName) {
        var session = Sessions.getSession(sessionName);
        if (session) {
            if (session.state != "CLOSED") {
                session.generation = (session.generation || 0) + 1;
                if (session.client) {
                    // enquanto aguarda o QR ser lido o create() não resolve: nesse caso fecha
                    // direto o navegador (o create() pendente falha e initSession() descarta)
                    const client = (session.state != "CONNECTED" && session.browser) ? null : await Promise.race([
                        session.client.catch(() => null),
                        new Promise(resolve => setTimeout(resolve, CLOSE_TIMEOUT, null))
                    ]);
                    if (client) {
                        await client.close().catch(error => console.log("client.close(): " + error.message));
                    } else if (session.browser) {
                        await session.browser.close().catch(error => console.log("browser.close(): " + error.message));
                    }
                }
                session.browser = null;
                session.state = "CLOSED";
                session.client = false;
                console.log("client.close - session.state: " + session.state);
                return { result: "success", message: "CLOSED" };
            } else { //close
                return { result: "success", message: session.state };
            }
        } else {
            return { result: "error", message: "NOTFOUND" };
        }
    } //close

    static getSession(sessionName) {
        var foundSession = false;
        if (Sessions.sessions)
            Sessions.sessions.forEach(session => {
                if (sessionName == session.name) {
                    foundSession = session;
                }
            });
        return foundSession;
    } //getSession

    static getSessions() {
        if (Sessions.sessions) {
            return Sessions.sessions;
        } else {
            return [];
        }
    } //getSessions

    /**
     * Executa fn(client, session) se a sessão existir e estiver CONNECTED.
     * Retorna o resultado de fn ou { result: "error", message }.
     */
    static async withClient(sessionName, fn) {
        var session = Sessions.getSession(sessionName);
        if (!session) {
            return { result: "error", message: "NOTFOUND" };
        }
        if (session.state != "CONNECTED") {
            return { result: "error", message: session.state };
        }
        try {
            const client = await session.client;
            return await fn(client, session);
        } catch (error) {
            console.log(error);
            return { result: "error", message: error.message || String(error) };
        }
    } //withClient

    static async sendText(req) {
        var params = {
            sessionName: req.body.sessionName,
            number: req.body.number,
            text: req.body.text
        }
        return Sessions.withClient(params.sessionName, async client => {
            console.log('#### send msg =', params);
            await client.sendText(chatId(params.number), params.text);
            return { result: "success" };
        });
    } //message

    static async sendTextToStorie(req) {
        var params = {
            sessionName: req.body.sessionName,
            text: req.body.text
        }
        return Sessions.withClient(params.sessionName, async client => {
            console.log('#### send msg =', params);
            await client.sendText('status@broadcast', params.text);
            return { result: "success" };
        });
    } //message to storie

    static async sendBase64File(session, client, to, base64Data, fileName, caption) {
        var folderName = fs.mkdtempSync(path.join(os.tmpdir(), session.name + '-'));
        try {
            var safeName = path.basename(fileName);
            var filePath = path.join(folderName, safeName);
            fs.writeFileSync(filePath, base64Data, 'base64');
            console.log(filePath);
            await client.sendFile(to, filePath, safeName, caption);
        } finally {
            fs.rmSync(folderName, { recursive: true, force: true });
        }
    } //sendBase64File

    static async sendFile(sessionName, number, base64Data, fileName, caption) {
        return Sessions.withClient(sessionName, async (client, session) => {
            await Sessions.sendBase64File(session, client, chatId(number), base64Data, fileName, caption);
            return { result: "success" };
        });
    } //message

    static async sendImageStorie(sessionName, base64Data, fileName, caption) {
        return Sessions.withClient(sessionName, async (client, session) => {
            await Sessions.sendBase64File(session, client, 'status@broadcast', base64Data, fileName, caption);
            return { result: "success" };
        });
    } //sendImageStorie

    static async saveHook(req) {
        var session = Sessions.getSession(req.body.sessionName);
        if (!session) {
            return { result: "error", message: 'Session not found' };
        }
        session.hook = req.body.hook;
        return { result: "success", message: 'Hook Atualizado' };
    } //saveHook

    static async sendContactVcard(sessionName, number, numberCard, nameCard) {
        return Sessions.withClient(sessionName, async client => {
            await client.sendContactVcard(chatId(number), chatId(numberCard), nameCard);
            return { result: "success" };
        });
    } //vcard

    static async sendVoice(sessionName, number, voice) {
        return Sessions.withClient(sessionName, async client => {
            if (config.engine === 'VENOM') {
                await client.sendVoiceBase64(chatId(number), voice);
            } else {
                await client.sendPttFromBase64(chatId(number), voice, 'voice.ogg');
            }
            return { result: "success" };
        });
    } //voice

    static async sendLocation(sessionName, number, lat, long, local) {
        return Sessions.withClient(sessionName, async client => {
            await client.sendLocation(chatId(number), lat, long, local);
            return { result: "success" };
        });
    } //location

    static async sendLinkPreview(sessionName, number, url, caption) {
        return Sessions.withClient(sessionName, async client => {
            if (config.engine === 'VENOM') {
                await client.sendLinkPreview(chatId(number), url, caption || '', '');
            } else {
                await client.sendLinkPreview(chatId(number), url, caption);
            }
            return { result: "success" };
        });
    } //link

    static async getAllChatsNewMsg(sessionName) {
        return Sessions.withClient(sessionName, async client => {
            if (config.engine === 'VENOM') {
                return { result: await client.getAllChatsNewMsg() };
            }
            return { result: await client.listChats({ onlyWithUnreadMessage: true }) };
        });
    } //getAllChatsNewMsg

    static async getAllUnreadMessages(sessionName) {
        return Sessions.withClient(sessionName, async client => {
            if (typeof client.getAllUnreadMessages !== 'function') {
                return { result: "error", message: "NOT_SUPPORTED_BY_ENGINE" };
            }
            return { result: await client.getAllUnreadMessages() };
        });
    } //getAllUnreadMessages

    static async checkNumberStatus(sessionName, number) {
        return Sessions.withClient(sessionName, async client => {
            return { result: await client.checkNumberStatus(chatId(number)) };
        });
    } //saber se o número é válido

    static async getNumberProfile(sessionName, number) {
        return Sessions.withClient(sessionName, async client => {
            return { result: await client.getNumberProfile(chatId(number)) };
        });
    } //receber o perfil do usuário
}
