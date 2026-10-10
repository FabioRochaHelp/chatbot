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
// depois de uma falha (WhatsApp Web carregando, rede), tenta de novo em 1 hora
const RETRY_MS = 3600 * 1000;
const DOWNLOAD_TIMEOUT_MS = 10000;
const MAX_BYTES = 2 * 1024 * 1024;
// busca em lote ao conectar: contatos com conversa recente, um de cada vez
const SWEEP_DAYS = 30;
const SWEEP_LIMIT = 300;
const SWEEP_GAP_MS = 1500;

const running = new Set();
// buscas em lote em andamento, por sessão
const sweeps = new Map();

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
 * Devolve { contact, error }: error é o motivo quando não deu para consultar (tenta de novo em 1 hora).
 * deps.fetch: troca o fetch (testes).
 */
async function refresh(sessionName, contact, client, deps = {}) {
    if (running.has(contact.id)) return { contact, error: 'já em andamento' };
    running.add(contact.id);
    try {
        // erro aqui é falha de consulta, não "sem foto": não pode marcar o contato como consultado
        const url = await engine.getProfilePicUrl(client, contact.waId);
        let avatarPath = null;
        if (url) {
            const response = await (deps.fetch || globalThis.fetch)(url, {
                signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS)
            });
            if (!response.ok) throw new Error('download da foto: HTTP ' + response.status);
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
        return { contact: updated, error: null };
    } catch (error) {
        const reason = (error && error.message) || String(error);
        log.warn({ contact: contact.id, waId: contact.waId, reason }, 'não foi possível buscar a foto do contato');
        // não insiste a cada mensagem, mas tenta de novo em 1 hora (e não em 24)
        const retryAt = new Date(Date.now() - REFRESH_MS + RETRY_MS);
        const updated = await db()
            .contact.update({ where: { id: contact.id }, data: { avatarCheckedAt: retryAt } })
            .catch(() => contact);
        return { contact: updated, error: reason };
    } finally {
        running.delete(contact.id);
    }
}

/** Atualiza em segundo plano se a última consulta tiver mais de um dia. */
function refreshIfStale(sessionName, contact, client) {
    if (!client || !isStale(contact)) return;
    refresh(sessionName, contact, client).catch(() => null);
}

/**
 * Busca em lote as fotos dos contatos com conversa nos últimos 30 dias (os mais recentes primeiro),
 * um por vez para não sobrecarregar o WhatsApp Web. force: ignora a regra de uma vez por dia.
 * Uma busca por sessão de cada vez. Devolve quantos contatos entraram na fila.
 */
async function sweep(sessionName, client, { force = false, gapMs = SWEEP_GAP_MS } = {}) {
    if (!client || sweeps.has(sessionName)) return 0;
    const session = await db().session.findUnique({ where: { name: sessionName }, select: { id: true } });
    if (!session) return 0;
    const since = new Date(Date.now() - SWEEP_DAYS * 86400000);
    const contacts = await db().contact.findMany({
        where: {
            sessionId: session.id,
            conversations: { some: { lastMessageAt: { gte: since } } },
            ...(force
                ? {}
                : { OR: [{ avatarCheckedAt: null }, { avatarCheckedAt: { lt: new Date(Date.now() - REFRESH_MS) } }] })
        },
        orderBy: { updatedAt: 'desc' },
        take: SWEEP_LIMIT
    });
    if (!contacts.length) return 0;
    const job = (async () => {
        let saved = 0;
        let failed = 0;
        for (const [index, contact] of contacts.entries()) {
            if (index > 0 && gapMs) await new Promise(resolve => setTimeout(resolve, gapMs));
            const result = await refresh(sessionName, contact, client).catch(error => ({ error: error.message }));
            if (result.error) failed += 1;
            else if (result.contact && result.contact.avatarPath) saved += 1;
        }
        log.info(
            { session: sessionName, contacts: contacts.length, photos: saved, failed },
            'fotos dos contatos atualizadas'
        );
    })()
        .catch(error => log.warn({ err: error, session: sessionName }, 'falha na busca de fotos'))
        .finally(() => sweeps.delete(sessionName));
    sweeps.set(sessionName, job);
    return contacts.length;
}

/** Espera as buscas em lote em andamento terminarem (testes, desligamento). */
const idle = () => Promise.all([...sweeps.values()]);

module.exports = { refresh, refreshIfStale, sweep, idle, isStale, REFRESH_MS, RETRY_MS };
