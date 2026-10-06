'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const config = require('./config');
const engine = require('./engine');
const store = require('./store');
const log = require('./logger');

// o shutdown (SIGTERM/SIGINT) é feito pelo index.js, que fecha as sessões em ordem
// (o puppeteer continua matando o navegador no evento 'exit' do processo)
const PUPPETEER_SIGNALS = { handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false };
const CLOSE_TIMEOUT = 5000;
// intervalo entre as sessões restauradas no boot (cada uma abre um Chromium)
const RESTORE_INTERVAL = 1500;

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

module.exports = class Sessions {
    static async start(sessionName) {
        Sessions.sessions = Sessions.sessions || []; //start array

        var session = Sessions.getSession(sessionName);

        if (session == false) {
            //create new session
            log.debug({ session: sessionName }, 'nova sessão');
            session = await Sessions.addSesssion(sessionName);
        } else if (['CLOSED'].includes(session.state)) {
            //restart session
            log.debug({ session: sessionName }, 'reiniciando sessão fechada');
            session.state = 'STARTING';
            session.status = 'notLogged';
            Sessions.launch(session);
        } else if (['CONFLICT', 'UNPAIRED', 'UNLAUNCHED'].includes(session.state)) {
            log.debug({ session: sessionName, state: session.state }, 'client.useHere()');
            session.client
                .then(client => client.useHere())
                .catch(error => log.warn({ session: sessionName, err: error }, 'useHere falhou'));
        } else {
            log.debug({ session: sessionName, state: session.state }, 'sessão já ativa');
        }
        await store.saveSession(sessionName);
        return session;
    } //start

    /** Reinicia as sessões com autoStart (chamado quando o servidor sobe). */
    static async restore() {
        const names = await store.listAutoStart();
        for (const [index, name] of names.entries()) {
            if (index > 0) await new Promise(resolve => setTimeout(resolve, RESTORE_INTERVAL));
            log.info({ session: name }, 'restaurando sessão');
            await Sessions.start(name);
        }
        return names;
    } //restore

    static async getStatus(sessionName) {
        Sessions.sessions = Sessions.sessions || [];
        return Sessions.getSession(sessionName);
    } //getStatus

    static async addSesssion(sessionName) {
        var newSession = {
            name: sessionName,
            hook: await store.getLegacyHook(sessionName),
            qrcode: false,
            client: false,
            status: 'notLogged',
            state: 'STARTING'
        };
        Sessions.sessions.push(newSession);
        log.debug({ session: sessionName, state: newSession.state }, 'sessão adicionada');

        Sessions.launch(newSession);

        return newSession;
    } //addSession

    static launch(session) {
        session.generation = (session.generation || 0) + 1;
        const generation = session.generation;
        session.client = Sessions.initSession(session.name, generation);
        // se o navegador não subir, marca como CLOSED para que /start tente de novo
        session.client.catch(error => {
            log.error({ session: session.name, err: error }, 'initSession falhou');
            if (session.generation === generation) {
                session.state = 'CLOSED';
                session.client = false;
            }
        });
        Sessions.setup(session.name);
    } //launch

    static async initSession(sessionName, generation) {
        var session = Sessions.getSession(sessionName);
        session.browserSessionToken = null;
        if (config.jsonbinio) {
            //se informou secret key pra salvar na nuvem
            //busca token da session na nuvem
            try {
                const record = await jsonbin.get();
                if (record && record.WAToken1 !== undefined) {
                    session.browserSessionToken = record;
                    log.info({ session: sessionName }, 'token carregado da nuvem');
                } else {
                    log.info({ session: sessionName }, 'não havia token na nuvem');
                }
            } catch (error) {
                log.warn({ err: error }, 'jsonbin.io');
            }
        } //if jsonbinio

        const catchQR = (base64Qrimg, asciiQR, attempts, urlCode) => {
            if (session.generation !== generation) return;
            session.state = 'QRCODE';
            session.qrcode = base64Qrimg;
            session.CodeasciiQR = asciiQR;
            session.CodeurlCode = urlCode;
        };
        const statusFind = (statusSession, name) => {
            log.info({ session: name, status: statusSession }, 'statusFind');
        };
        const options = {
            session: session.name,
            catchQR: catchQR,
            statusFind: statusFind,
            folderNameToken: config.tokensDir,
            devtools: false,
            debug: false,
            logQR: true,
            disableWelcome: true,
            updatesLog: true,
            autoClose: 60000,
            createPathFileToken: true,
            waitForLogin: true
        };
        const client = await engine.create(session, options, PUPPETEER_SIGNALS);
        if (session.generation !== generation) {
            // fechada (ou reiniciada) antes do login
            await client.close().catch(() => null);
            throw new Error('sessão fechada antes de conectar');
        }
        session.state = 'CONNECTED';
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
            store.setLastState(sessionName, state);
            if (state == 'CONNECTED' && config.jsonbinio && session.browserSessionToken == undefined) {
                //salva dados do token da sessão na nuvem
                setTimeout(() => Sessions.saveCloudToken(client), 2000);
            }
            log.info({ session: sessionName, state: state }, 'onStateChange');
        });
        client.onMessage(async message => {
            var session = Sessions.getSession(sessionName);
            if (session.hook != null) {
                await axios
                    .post(session.hook, message, { headers: { 'Content-Type': 'application/json' } })
                    .then(response => log.debug({ session: sessionName, status: response.status }, 'hook entregue'))
                    .catch(error =>
                        log.warn({ session: sessionName, hook: session.hook, err: error.message }, 'hook falhou')
                    );
            } else if (message.body == 'TESTEBOT') {
                client.sendText(message.from, 'Hello\nfriend!');
            }
        });
    } //setup

    static async saveCloudToken(client) {
        // o venom 5 (e o login multidevice) não expõe mais o token do navegador
        if (typeof client.getSessionTokenBrowser !== 'function') {
            log.info('engine sem getSessionTokenBrowser: token não será salvo na nuvem');
            return;
        }
        try {
            log.info('gravando token na nuvem');
            const browserSessionToken = await client.getSessionTokenBrowser();
            await jsonbin.put(browserSessionToken);
        } catch (error) {
            log.warn({ err: error }, 'jsonbin.io');
        }
    } //saveCloudToken

    static async clearCloudToken() {
        if (!config.jsonbinio) return;
        try {
            log.info('limpando token na nuvem');
            await jsonbin.put({ nada: 'nada' });
        } catch (error) {
            log.warn({ err: error }, 'jsonbin.io');
        }
    } //clearCloudToken

    /**
     * Fecha a sessão. Fechar pela API desliga o autoStart; no shutdown do servidor
     * ({ shutdown: true }) a sessão continua marcada para voltar no próximo boot.
     */
    static async closeSession(sessionName, { shutdown = false } = {}) {
        var session = Sessions.getSession(sessionName);
        if (session && !shutdown) await store.setAutoStart(sessionName, false);
        if (session) {
            if (session.state != 'CLOSED') {
                session.generation = (session.generation || 0) + 1;
                if (session.client) {
                    // enquanto aguarda o QR ser lido o create() não resolve: nesse caso fecha
                    // direto o navegador (o create() pendente falha e initSession() descarta)
                    const client =
                        session.state != 'CONNECTED' && session.browser
                            ? null
                            : await Promise.race([
                                  session.client.catch(() => null),
                                  new Promise(resolve => setTimeout(resolve, CLOSE_TIMEOUT, null))
                              ]);
                    if (client) {
                        await client
                            .close()
                            .catch(error => log.warn({ session: sessionName, err: error }, 'client.close()'));
                    } else if (session.browser) {
                        await session.browser
                            .close()
                            .catch(error => log.warn({ session: sessionName, err: error }, 'browser.close()'));
                    }
                }
                session.browser = null;
                session.state = 'CLOSED';
                if (!shutdown) store.setLastState(sessionName, 'CLOSED');
                session.client = false;
                log.info({ session: sessionName }, 'sessão fechada');
                return { result: 'success', message: 'CLOSED' };
            } else {
                //close
                return { result: 'success', message: session.state };
            }
        } else {
            return { result: 'error', message: 'NOTFOUND' };
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
            return { result: 'error', message: 'NOTFOUND' };
        }
        if (session.state != 'CONNECTED') {
            return { result: 'error', message: session.state };
        }
        try {
            const client = await session.client;
            return await fn(client, session);
        } catch (error) {
            log.error({ session: sessionName, err: error }, 'erro no client');
            return { result: 'error', message: (error && error.message) || String(error) };
        }
    } //withClient

    static async sendText(sessionName, to, text) {
        return Sessions.withClient(sessionName, async client => {
            log.debug({ session: sessionName, to: to }, 'sendText');
            await client.sendText(to, text);
            return { result: 'success' };
        });
    } //message

    static async sendTextToStorie(sessionName, text) {
        return Sessions.sendText(sessionName, 'status@broadcast', text);
    } //message to storie

    static async sendBase64File(session, client, to, base64Data, fileName, caption) {
        var folderName = fs.mkdtempSync(path.join(os.tmpdir(), session.name + '-'));
        try {
            var safeName = path.basename(fileName);
            var filePath = path.join(folderName, safeName);
            fs.writeFileSync(filePath, base64Data, 'base64');
            await client.sendFile(to, filePath, safeName, caption);
        } finally {
            fs.rmSync(folderName, { recursive: true, force: true });
        }
    } //sendBase64File

    static async sendFile(sessionName, to, base64Data, fileName, caption) {
        return Sessions.withClient(sessionName, async (client, session) => {
            await Sessions.sendBase64File(session, client, to, base64Data, fileName, caption);
            return { result: 'success' };
        });
    } //message

    static async sendImageStorie(sessionName, base64Data, fileName, caption) {
        return Sessions.sendFile(sessionName, 'status@broadcast', base64Data, fileName, caption);
    } //sendImageStorie

    static async saveHook(sessionName, hook) {
        var session = Sessions.getSession(sessionName);
        if (!session) {
            return { result: 'error', message: 'Session not found' };
        }
        session.hook = hook || null;
        await store.saveLegacyHook(sessionName, session.hook);
        return { result: 'success', message: 'Hook Atualizado' };
    } //saveHook

    static async sendContactVcard(sessionName, to, contactId, nameCard) {
        return Sessions.withClient(sessionName, async client => {
            await client.sendContactVcard(to, contactId, nameCard);
            return { result: 'success' };
        });
    } //vcard

    static async sendVoice(sessionName, to, voice) {
        return Sessions.withClient(sessionName, async client => {
            await engine.sendVoice(client, to, voice);
            return { result: 'success' };
        });
    } //voice

    static async sendLocation(sessionName, to, lat, long, local) {
        return Sessions.withClient(sessionName, async client => {
            await client.sendLocation(to, lat, long, local);
            return { result: 'success' };
        });
    } //location

    static async sendLinkPreview(sessionName, to, url, caption) {
        return Sessions.withClient(sessionName, async client => {
            await engine.sendLinkPreview(client, to, url, caption);
            return { result: 'success' };
        });
    } //link

    static async getAllChatsNewMsg(sessionName) {
        return Sessions.withClient(sessionName, async client => {
            return { result: await engine.getAllChatsNewMsg(client) };
        });
    } //getAllChatsNewMsg

    static async getAllUnreadMessages(sessionName) {
        return Sessions.withClient(sessionName, async client => {
            if (typeof client.getAllUnreadMessages !== 'function') {
                return { result: 'error', message: 'NOT_SUPPORTED_BY_ENGINE' };
            }
            return { result: await client.getAllUnreadMessages() };
        });
    } //getAllUnreadMessages

    static async checkNumberStatus(sessionName, to) {
        return Sessions.withClient(sessionName, async client => {
            return { result: await client.checkNumberStatus(to) };
        });
    } //saber se o número é válido

    static async getNumberProfile(sessionName, to) {
        return Sessions.withClient(sessionName, async client => {
            return { result: await client.getNumberProfile(to) };
        });
    } //receber o perfil do usuário
};
