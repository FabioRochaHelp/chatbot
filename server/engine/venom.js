'use strict';

// DEPRECATED: o venom-bot não tem releases desde 11/2024 e não gera mais o QR code
const path = require('path');
const config = require('../config');
const BROWSER_ARGS = require('./browser-args');
const { clearStaleProfileLock } = require('./profile-lock');

module.exports = {
    name: 'VENOM',

    async create(session, options, puppeteerOptions) {
        // o venom usa <folderNameToken>/<sessão> como perfil do navegador
        clearStaleProfileLock(path.join(options.folderNameToken, session.name));
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
    getAllChatsNewMsg: client => client.getAllChatsNewMsg(),
    getChatName: async (client, chatId) => {
        const chat = await client.getChatById(chatId);
        return (chat && (chat.name || chat.formattedTitle)) || null;
    },
    getProfilePicUrl: async (client, chatId) => {
        const url = await client.getProfilePicFromServer(chatId);
        return typeof url === 'string' && /^https?:/.test(url) ? url : null;
    }
};
