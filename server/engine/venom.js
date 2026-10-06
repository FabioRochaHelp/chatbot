'use strict';

// DEPRECATED: o venom-bot não tem releases desde 11/2024 e não gera mais o QR code
const config = require('../config');
const BROWSER_ARGS = require('./browser-args');

module.exports = {
    name: 'VENOM',

    async create(session, options, puppeteerOptions) {
        return require('venom-bot').create({
            ...options,
            headless: 'new',
            browserArgs: BROWSER_ARGS,
            browserPathExecutable: config.chromePath,
            BrowserFetcher: false,
            puppeteerOptions: puppeteerOptions,
            disableSpins: true,
            browserInstance: browser => {
                session.browser = browser;
            }
        });
    },

    sendVoice: (client, to, base64) => client.sendVoiceBase64(to, base64),
    sendLinkPreview: (client, to, url, caption) => client.sendLinkPreview(to, url, caption || '', ''),
    getAllChatsNewMsg: client => client.getAllChatsNewMsg()
};
