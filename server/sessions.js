'use strict';

const axios = require('axios');
const config = require('./config');
const engine = require('./engine');
const store = require('./store');
const history = require('./history');
const messaging = require('./messaging');
const pipeline = require('./pipeline');
const avatars = require('./avatars');
const events = require('./events');
const { AppError } = require('./errors');
const log = require('./logger');

// o shutdown (SIGTERM/SIGINT) é feito pelo index.js, que fecha as sessões em ordem
// (o puppeteer continua matando o navegador no evento 'exit' do processo)
const PUPPETEER_SIGNALS = { handleSIGINT: false, handleSIGTERM: false, handleSIGHUP: false };
const CLOSE_TIMEOUT = 5000;
const LOGOUT_TIMEOUT = 10000;
// espera depois de conectar antes de buscar as fotos dos contatos
const AVATAR_SWEEP_DELAY_MS = 10000;
// intervalo entre as sessões restauradas no boot (cada uma abre um Chromium)
const RESTORE_INTERVAL = 1500;

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

        const catchQR = (base64Qrimg, asciiQR, attempts, urlCode) => {
            if (session.generation !== generation) return;
            session.state = 'QRCODE';
            session.qrcode = base64Qrimg;
            events.emit('session.qrcode', { session: session.name, qrcode: base64Qrimg });
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

        // fotos dos contatos com conversa recente (espera o WhatsApp Web terminar de carregar)
        const sweepAvatars = () =>
            setTimeout(() => {
                if (session.generation === generation && session.state === 'CONNECTED') {
                    avatars.sweep(sessionName, client).catch(error => log.warn({ err: error }, 'busca de fotos'));
                }
            }, AVATAR_SWEEP_DELAY_MS).unref();
        sweepAvatars();

        client.onStateChange(state => {
            if (session.generation !== generation) return;
            session.state = state;
            store.setLastState(sessionName, state);
            events.emit('session.state', { session: sessionName, state });
            if (state === 'CONNECTED') sweepAvatars();
            log.info({ session: sessionName, state: state }, 'onStateChange');
        });
        // onAnyMessage também traz o que foi enviado pelo celular (fromMe)
        if (typeof client.onAnyMessage === 'function') {
            client.onAnyMessage(async message => {
                if (session.generation !== generation) return;
                const saved = await history.recordIncoming(sessionName, message, client);
                // bot (fluxo) responde mensagens recebidas em conversas com status "bot"
                pipeline
                    .handle(Sessions, sessionName, saved)
                    .catch(error => log.error({ session: sessionName, err: error }, 'erro no pipeline'));
            });
        }
        client.onMessage(async message => {
            var session = Sessions.getSession(sessionName);
            if (session.hook != null) {
                await axios
                    .post(session.hook, message, { headers: { 'Content-Type': 'application/json' } })
                    .then(response => log.debug({ session: sessionName, status: response.status }, 'hook entregue'))
                    .catch(error =>
                        log.warn({ session: sessionName, hook: session.hook, err: error.message }, 'hook falhou')
                    );
            }
        });
    } //setup

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

    /**
     * Tira a sessão do ar para excluir: desconecta o aparelho no WhatsApp (logout, se estiver conectada),
     * fecha o navegador e remove da memória. Os dados (banco, arquivos) ficam com quem chamou.
     * Devolve { loggedOut }.
     */
    static async remove(sessionName, { logout = true } = {}) {
        var session = Sessions.getSession(sessionName);
        if (!session) return { loggedOut: false };
        let loggedOut = false;
        if (logout && session.state === 'CONNECTED' && session.client) {
            try {
                const client = await session.client;
                if (typeof client.logout === 'function') {
                    await Promise.race([
                        client.logout(),
                        new Promise((resolve, reject) =>
                            setTimeout(() => reject(new Error('tempo esgotado')), LOGOUT_TIMEOUT)
                        )
                    ]);
                    loggedOut = true;
                }
            } catch (error) {
                log.warn(
                    { session: sessionName, err: error },
                    'logout no WhatsApp falhou; o aparelho pode continuar em Aparelhos conectados'
                );
            }
        }
        // shutdown: não grava autoStart/estado (o registro vai ser apagado)
        await Sessions.closeSession(sessionName, { shutdown: true });
        Sessions.sessions = Sessions.getSessions().filter(item => item.name !== sessionName);
        return { loggedOut };
    } //remove

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

    /** Envio pelas rotas antigas: { result: "success" } ou { result: "error", message }. */
    static async legacySend(sessionName, content) {
        try {
            await messaging.send(Sessions, sessionName, content);
            return { result: 'success' };
        } catch (error) {
            if (error instanceof AppError) return { result: 'error', message: error.legacyMessage };
            throw error;
        }
    } //legacySend

    static async sendText(sessionName, to, text) {
        return Sessions.legacySend(sessionName, { type: 'text', to, text });
    } //message

    static async sendTextToStorie(sessionName, text) {
        return Sessions.sendText(sessionName, 'status@broadcast', text);
    } //message to storie

    static async sendFile(sessionName, to, base64Data, fileName, caption) {
        return Sessions.legacySend(sessionName, { type: 'file', to, base64: base64Data, fileName, caption });
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
        return Sessions.legacySend(sessionName, { type: 'contact', to, contact: contactId, name: nameCard });
    } //vcard

    static async sendVoice(sessionName, to, voice) {
        return Sessions.legacySend(sessionName, { type: 'voice', to, base64: voice });
    } //voice

    static async sendLocation(sessionName, to, lat, long, local) {
        return Sessions.legacySend(sessionName, { type: 'location', to, lat, lng: long, name: local });
    } //location

    static async sendLinkPreview(sessionName, to, url, caption) {
        return Sessions.legacySend(sessionName, { type: 'link', to, url, caption });
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
