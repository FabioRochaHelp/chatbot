'use strict';

const os = require('os');
const fs = require('fs');
const path = require('path');
const engine = require('./engine');
const history = require('./history');
const log = require('./logger');
const { AppError } = require('./errors');

function base64Buffer(base64) {
    // aceita data URL (data:image/png;base64,...) ou base64 puro
    return Buffer.from(String(base64).replace(/^data:[^,]*,/, ''), 'base64');
}

async function sendBase64File(sessionName, client, to, buffer, fileName, caption) {
    var folderName = fs.mkdtempSync(path.join(os.tmpdir(), sessionName + '-'));
    try {
        var safeName = path.basename(fileName);
        var filePath = path.join(folderName, safeName);
        fs.writeFileSync(filePath, buffer);
        return await client.sendFile(to, filePath, safeName, caption);
    } finally {
        fs.rmSync(folderName, { recursive: true, force: true });
    }
}

// cada tipo: envia pelo client e descreve o que será gravado no histórico
const senders = {
    async text(sessionName, client, to, { text }) {
        return [await client.sendText(to, text), { type: 'chat', body: text }];
    },
    async file(sessionName, client, to, { base64, fileName, caption }) {
        const buffer = base64Buffer(base64);
        const sent = await sendBase64File(sessionName, client, to, buffer, fileName, caption);
        return [sent, { type: 'document', caption, fileName: path.basename(fileName), buffer }];
    },
    async voice(sessionName, client, to, { base64 }) {
        const sent = await engine.sendVoice(client, to, base64);
        return [sent, { type: 'ptt', mimeType: 'audio/ogg', fileName: 'voice.ogg', buffer: base64Buffer(base64) }];
    },
    async location(sessionName, client, to, { lat, lng, name }) {
        // o wppconnect espera latitude/longitude como string
        const sent = await client.sendLocation(to, String(lat), String(lng), name || '');
        return [sent, { type: 'location', payload: { lat, lng, name: name || null } }];
    },
    async link(sessionName, client, to, { url, caption }) {
        const sent = await engine.sendLinkPreview(client, to, url, caption);
        return [sent, { type: 'link', body: caption ? caption + '\n' + url : url, payload: { url } }];
    },
    async contact(sessionName, client, to, { contact, name }) {
        const sent = await client.sendContactVcard(to, contact, name);
        return [sent, { type: 'vcard', payload: { contact, name: name || null } }];
    }
};

/** Cliente conectado da sessão ou AppError (404 sem sessão, 409 desconectada). */
async function connectedClient(Sessions, sessionName) {
    const session = Sessions.getSession(sessionName);
    if (!session) throw new AppError(404, 'SESSION_NOT_FOUND', 'sessão não encontrada', { legacyMessage: 'NOTFOUND' });
    if (session.state != 'CONNECTED') {
        throw new AppError(409, 'SESSION_NOT_CONNECTED', 'sessão não está conectada', {
            details: { state: session.state },
            legacyMessage: session.state
        });
    }
    return session.client;
}

/**
 * Envia e grava no histórico. content: { to, type: text|file|voice|location|link|contact, ... }.
 * meta: { origin: api|bot|agent, sentByUserId }. Retorna a mensagem gravada (ou null se o banco falhar).
 */
async function send(Sessions, sessionName, content, meta = {}) {
    const sender = senders[content.type];
    if (!sender) throw new AppError(400, 'INVALID_MESSAGE_TYPE', 'tipo de mensagem inválido: ' + content.type);
    const client = await connectedClient(Sessions, sessionName);
    let result;
    try {
        result = await sender(sessionName, client, content.to, content);
    } catch (error) {
        log.error({ session: sessionName, to: content.to, type: content.type, err: error }, 'falha no envio');
        const message = (error && error.message) || String(error);
        throw new AppError(502, 'SEND_FAILED', message, { legacyMessage: message });
    }
    const [sent, record] = result;
    return history.recordOutgoing(sessionName, content.to, record, sent, meta);
}

module.exports = { send, connectedClient };
