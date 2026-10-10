'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { db } = require('./db');
const engine = require('./engine');
const events = require('./events');
const log = require('./logger');

// a foto é consultada no máximo uma vez por dia por contato
const REFRESH_MS = 24 * 3600 * 1000;
const DOWNLOAD_TIMEOUT_MS = 10000;
const MAX_BYTES = 2 * 1024 * 1024;

const running = new Set();

function isStale(contact) {
    return !contact.avatarCheckedAt || Date.now() - new Date(contact.avatarCheckedAt).getTime() > REFRESH_MS;
}

/** Caminho relativo a MEDIA_DIR: avatars/<sessão>/<id do contato>.jpg */
const relativePath = (sessionName, contactId) =>
    path.join('avatars', sessionName.replace(/[^\w.-]/g, '_'), contactId + '.jpg');

/**
 * Baixa a foto de perfil do contato (ou grupo) e guarda localmente: as URLs do WhatsApp expiram.
 * Para grupos, atualiza também o nome do grupo.
 * Sem foto (ou privada): limpa a foto guardada. Avisa o painel com contact.updated quando muda.
 * deps.fetch: troca o fetch (testes).
 */
async function refresh(sessionName, contact, client, deps = {}) {
    if (running.has(contact.id)) return null;
    running.add(contact.id);
    try {
        const url = await engine.getProfilePicUrl(client, contact.waId).catch(() => null);
        let avatarPath = null;
        if (url) {
            const response = await (deps.fetch || globalThis.fetch)(url, {
                signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
            });
            if (!response.ok) throw new Error('HTTP ' + response.status);
            const buffer = Buffer.from(await response.arrayBuffer());
            if (buffer.length > MAX_BYTES) throw new Error('foto grande demais');
            avatarPath = relativePath(sessionName, contact.id);
            const absolute = path.join(config.mediaDir, avatarPath);
            fs.mkdirSync(path.dirname(absolute), { recursive: true });
            fs.writeFileSync(absolute, buffer);
        } else if (contact.avatarPath) {
            fs.rmSync(path.join(config.mediaDir, contact.avatarPath), { force: true });
        }
        const data = { avatarPath, avatarCheckedAt: new Date() };
        // grupo: o nome vem do WhatsApp (as mensagens só trazem o nome de quem escreveu)
        const groupName = contact.isGroup ? await engine.getChatName(client, contact.waId).catch(() => null) : null;
        if (groupName && groupName !== contact.pushName) data.pushName = groupName;
        const updated = await db().contact.update({ where: { id: contact.id }, data });
        // avisa quando há foto (o arquivo pode ter mudado), quando ela sumiu ou o nome do grupo mudou
        if (avatarPath || contact.avatarPath || data.pushName) events.emit('contact.updated', { contact: updated });
        return updated;
    } catch (error) {
        log.debug({ err: error, contact: contact.id }, 'foto do contato não baixada');
        // marca a tentativa para não insistir a cada mensagem
        await db()
            .contact.update({ where: { id: contact.id }, data: { avatarCheckedAt: new Date() } })
            .catch(() => null);
        return null;
    } finally {
        running.delete(contact.id);
    }
}

/** Atualiza em segundo plano se a última consulta tiver mais de um dia. */
function refreshIfStale(sessionName, contact, client) {
    if (!client || !isStale(contact)) return;
    refresh(sessionName, contact, client).catch(() => null);
}

module.exports = { refresh, refreshIfStale, isStale, REFRESH_MS };
