'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { db } = require('./db');
const events = require('./events');
const { botActive, BOT_SESSION_SELECT } = require('./bot-mode');
const log = require('./logger');

// avisos de sistema que não são conversa
const IGNORED_TYPES = new Set([
    'e2e_notification',
    'notification',
    'notification_template',
    'gp2',
    'call_log',
    'protocol',
    'ciphertext',
    'revoked'
]);
const MEDIA_TYPES = new Set(['image', 'video', 'audio', 'ptt', 'document', 'sticker']);
const EXTENSIONS = {
    'image/jpeg': 'jpg',
    'image/png': 'png',
    'image/webp': 'webp',
    'image/gif': 'gif',
    'video/mp4': 'mp4',
    'video/3gpp': '3gp',
    'audio/ogg': 'ogg',
    'audio/mpeg': 'mp3',
    'audio/mp4': 'm4a',
    'application/pdf': 'pdf'
};

const sessionIds = new Map();
// nome de quem enviou (atendente), para o inbox
const SENT_BY = { sentBy: { select: { id: true, name: true } } };

async function sessionId(name) {
    if (!sessionIds.has(name)) {
        const session = await db().session.upsert({
            where: { name },
            create: { name, engine: config.engine },
            update: {},
            select: { id: true }
        });
        sessionIds.set(name, session.id);
    }
    return sessionIds.get(name);
}

function serializedId(id) {
    if (!id) return null;
    if (typeof id === 'string') return id;
    return id._serialized || null;
}

/** Converte a mensagem do wppconnect/venom para os campos que guardamos. */
function normalize(message) {
    const fromMe = Boolean(message.fromMe || (message.id && message.id.fromMe));
    const chatId = serializedId(message.chatId) || (fromMe ? message.to : message.from);
    const type = message.type || 'chat';
    const isMedia = MEDIA_TYPES.has(type);
    const seconds = message.t || message.timestamp;
    let payload = null;
    if (type === 'location') payload = { lat: message.lat, lng: message.lng, name: message.loc || null };
    if (type === 'vcard' || type === 'multi_vcard') payload = { vcard: message.body };
    return {
        waMessageId: serializedId(message.id),
        chatId: serializedId(chatId),
        fromMe,
        type,
        // em mídia o body é a miniatura em base64: não guardamos
        body: isMedia || type === 'vcard' || type === 'multi_vcard' ? null : message.body || null,
        caption: message.caption || null,
        author: message.isGroupMsg ? serializedId(message.author) : null,
        mimeType: message.mimetype || null,
        fileName: message.filename || null,
        pushName: fromMe ? null : (message.sender && message.sender.pushname) || message.notifyName || null,
        isGroup: Boolean(message.isGroupMsg) || /@g\.us$/.test(chatId || ''),
        timestamp: seconds ? new Date(seconds * 1000) : new Date(),
        payload,
        isMedia
    };
}

function shouldRecord(fields) {
    return Boolean(fields.chatId) && fields.chatId !== 'status@broadcast' && !IGNORED_TYPES.has(fields.type);
}

/**
 * Grava a mensagem: contato, conversa (abre uma nova se a última foi encerrada) e mensagem.
 * meta.origin: contact | phone | api | bot | agent. Dedup por waMessageId: a mensagem enviada pela API
 * também chega pelo onAnyMessage, e quem gravar por último completa os campos.
 */
async function save(sessionName, fields, meta = {}) {
    const sid = await sessionId(sessionName);
    const direction = fields.fromMe ? 'out' : 'in';
    const origin = meta.origin || (fields.fromMe ? 'phone' : 'contact');

    const contact = await db().contact.upsert({
        where: { sessionId_waId: { sessionId: sid, waId: fields.chatId } },
        create: { sessionId: sid, waId: fields.chatId, pushName: fields.pushName, isGroup: fields.isGroup },
        update: fields.pushName ? { pushName: fields.pushName } : {}
    });

    let conversation = await db().conversation.findFirst({
        where: { contactId: contact.id, status: { not: 'closed' } },
        orderBy: { id: 'desc' }
    });
    if (!conversation) {
        // sem bot ativo (desligado ou sem fluxo publicado) a conversa já nasce aguardando atendente
        const session = await db().session.findUnique({ where: { id: sid }, select: BOT_SESSION_SELECT });
        conversation = await db().conversation.create({
            data: { sessionId: sid, contactId: contact.id, status: botActive(session) ? 'bot' : 'pending' }
        });
    }

    const data = {
        direction,
        origin,
        type: fields.type,
        body: fields.body,
        caption: fields.caption,
        author: fields.author,
        mimeType: fields.mimeType,
        fileName: fields.fileName,
        mediaPath: meta.mediaPath || null,
        payload: fields.payload || undefined,
        sentByUserId: meta.sentByUserId || null,
        timestamp: fields.timestamp
    };
    let message;
    let created = true;
    if (fields.waMessageId) {
        const key = { sessionId_waMessageId: { sessionId: sid, waMessageId: fields.waMessageId } };
        const existing = await db().message.findUnique({ where: key });
        if (existing) {
            created = false;
            // a origem informada pela API/bot vale mais que a inferida pelo evento do WhatsApp
            const update = meta.origin ? { origin, sentByUserId: data.sentByUserId } : {};
            if (data.mediaPath && !existing.mediaPath) update.mediaPath = data.mediaPath;
            message = Object.keys(update).length
                ? await db().message.update({ where: key, data: update, include: SENT_BY })
                : existing;
        }
    }
    if (!message) {
        message = await db().message.create({
            data: {
                ...data,
                sessionId: sid,
                conversationId: conversation.id,
                waMessageId: fields.waMessageId
            },
            include: SENT_BY
        });
    }

    if (created) {
        conversation = await db().conversation.update({
            where: { id: conversation.id },
            data: {
                lastMessageAt: fields.timestamp,
                ...(direction === 'in' ? { unreadCount: { increment: 1 } } : {})
            }
        });
        events.emit('message.saved', { session: sessionName, message, conversation, contact });
    }
    return message;
}

function mediaFile(sessionName, waMessageId, mimeType, fileName) {
    const ext = (fileName && path.extname(fileName).slice(1)) || EXTENSIONS[(mimeType || '').split(';')[0]] || 'bin';
    const month = new Date().toISOString().slice(0, 7);
    const base = (waMessageId || Date.now() + '-' + Math.random().toString(36).slice(2)).replace(/[^\w.-]/g, '_');
    return path.join(sessionName, month, base + '.' + ext.replace(/[^\w]/g, ''));
}

/** Grava buffer em DATA_DIR/media e retorna o caminho relativo. */
function writeMedia(sessionName, waMessageId, buffer, mimeType, fileName) {
    const relative = mediaFile(sessionName, waMessageId, mimeType, fileName);
    const absolute = path.join(config.mediaDir, relative);
    fs.mkdirSync(path.dirname(absolute), { recursive: true });
    fs.writeFileSync(absolute, buffer);
    return relative;
}

/** Caminho absoluto de uma mídia gravada (null se sair de MEDIA_DIR). */
function mediaAbsolutePath(relative) {
    if (!relative) return null;
    const absolute = path.resolve(config.mediaDir, relative);
    return absolute.startsWith(config.mediaDir + path.sep) ? absolute : null;
}

/** Evento onAnyMessage: grava e baixa a mídia (recebida ou enviada pelo celular). */
async function recordIncoming(sessionName, message, client) {
    try {
        const fields = normalize(message);
        if (!shouldRecord(fields)) return null;
        const saved = await save(sessionName, fields);
        if (fields.isMedia && !saved.mediaPath && client && typeof client.decryptFile === 'function') {
            const buffer = await client.decryptFile(message);
            if (buffer.length <= config.mediaMaxBytes) {
                const mediaPath = writeMedia(sessionName, fields.waMessageId, buffer, fields.mimeType, fields.fileName);
                const updated = await db().message.update({
                    where: { id: saved.id },
                    data: { mediaPath },
                    include: SENT_BY
                });
                // a mensagem já foi exibida; avisa que a mídia ficou disponível
                events.emit('message.updated', { session: sessionName, message: updated });
                return updated;
            }
            log.warn({ session: sessionName, size: buffer.length }, 'mídia acima de MEDIA_MAX_MB: não gravada');
        }
        return saved;
    } catch (error) {
        log.error({ session: sessionName, err: error }, 'falha ao gravar mensagem recebida');
        return null;
    }
}

/**
 * Mensagem enviada por nós (API, bot, atendente). sent é o retorno do client (tem o id da mensagem).
 * content: { type, body, caption, mimeType, fileName, payload, buffer }.
 */
async function recordOutgoing(sessionName, to, content, sent, meta = {}) {
    try {
        const fields = {
            waMessageId: serializedId(sent && (sent.id || sent.msgId)),
            chatId: to,
            fromMe: true,
            type: content.type,
            body: content.body || null,
            caption: content.caption || null,
            author: null,
            mimeType: content.mimeType || null,
            fileName: content.fileName || null,
            pushName: null,
            isGroup: /@g\.us$/.test(to),
            timestamp: new Date(),
            payload: content.payload || null
        };
        if (!shouldRecord(fields)) return null;
        const mediaPath = content.buffer
            ? writeMedia(sessionName, fields.waMessageId, content.buffer, fields.mimeType, fields.fileName)
            : null;
        return await save(sessionName, fields, { ...meta, origin: meta.origin || 'api', mediaPath });
    } catch (error) {
        log.error({ session: sessionName, err: error }, 'falha ao gravar mensagem enviada');
        return null;
    }
}

/** Nota interna do atendente: fica no histórico da conversa, não vai para o WhatsApp. */
async function addNote(conversation, text, userId) {
    const message = await db().message.create({
        data: {
            sessionId: conversation.sessionId,
            conversationId: conversation.id,
            direction: 'note',
            origin: 'agent',
            type: 'note',
            body: text,
            sentByUserId: userId || null
        },
        include: SENT_BY
    });
    const contact = await db().contact.findUnique({ where: { id: conversation.contactId } });
    const session = await db().session.findUnique({ where: { id: conversation.sessionId }, select: { name: true } });
    events.emit('message.saved', { session: session.name, message, conversation, contact });
    return message;
}

module.exports = {
    normalize,
    recordIncoming,
    recordOutgoing,
    addNote,
    mediaAbsolutePath,
    SENT_BY,
    _sessionIds: sessionIds
};
