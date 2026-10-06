'use strict';

const path = require('path');
const config = require('../config');
const BROWSER_ARGS = require('./browser-args');

// a lib só é carregada quando uma sessão é criada (cada engine puxa o seu puppeteer)
const lib = () => require('@wppconnect-team/wppconnect');

module.exports = {
    name: 'WPPCONNECT',

    /**
     * Cria o client. session.browser recebe o navegador para que closeSession()
     * consiga fechá-lo mesmo antes do login (o create() só resolve depois que o QR é lido).
     */
    async create(session, options, puppeteerOptions) {
        // mesmo launcher do wppconnect (puppeteer-extra + stealth), chamado aqui para guardar o browser
        const { initBrowser } = require('@wppconnect-team/wppconnect/dist/controllers/browser');
        session.browser = await initBrowser(
            session.name,
            {
                headless: true,
                devtools: false,
                useChrome: false,
                browserArgs: BROWSER_ARGS,
                puppeteerOptions: {
                    executablePath: config.chromePath,
                    userDataDir: path.join(config.tokensDir, session.name),
                    ...puppeteerOptions
                }
            },
            lib().defaultLogger
        );
        return lib().create({
            ...options,
            headless: true,
            browserArgs: BROWSER_ARGS,
            browser: session.browser,
            sessionToken: session.browserSessionToken || undefined
        });
    },

    sendVoice: (client, to, base64) => client.sendPttFromBase64(to, base64, 'voice.ogg'),
    sendLinkPreview: (client, to, url, caption) => client.sendLinkPreview(to, url, caption),
    getAllChatsNewMsg: client => client.listChats({ onlyWithUnreadMessage: true })
};
