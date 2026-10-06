'use strict';

const crypto = require('crypto');
const { db } = require('./db');
const events = require('./events');
const log = require('./logger');
const { version } = require('../package.json');

/**
 * Webhooks v2: cada evento vira uma entrega (WebhookDelivery) por webhook assinante; um worker envia
 * com assinatura HMAC e tenta de novo com espera crescente. A fila fica no banco (sobrevive a restart).
 *
 * Corpo: { id, event, createdAt, data }.
 * Cabeçalhos: X-ConectZap-Event, X-ConectZap-Delivery, X-ConectZap-Timestamp e
 * X-ConectZap-Signature: sha256=<hex HMAC-SHA256(secret, `${timestamp}.${corpo}`)>.
 */

const EVENTS = ['message.received', 'message.sent', 'conversation.updated', 'conversation.handoff', 'session.state'];
// espera antes de cada nova tentativa (a 1ª tentativa é imediata)
const BACKOFF_SECONDS = [10, 60, 300, 1800, 7200, 21600];
const MAX_ATTEMPTS = BACKOFF_SECONDS.length + 1;
const TIMEOUT_MS = 10000;
const BATCH = 20;
const RETENTION_DAYS = 7;

const newSecret = () => 'whsec_' + crypto.randomBytes(24).toString('base64url');

function sign(secret, timestamp, body) {
    return 'sha256=' + crypto.createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex');
}

// ---------- eventos -> entregas ----------

const sessionIds = new Map();
async function sessionIdOf(name) {
    if (!name) return null;
    if (!sessionIds.has(name)) {
        const session = await db().session.findUnique({ where: { name }, select: { id: true } });
        if (!session) return null;
        sessionIds.set(name, session.id);
    }
    return sessionIds.get(name);
}

/** Cria as entregas do evento para os webhooks ativos (não legados) que o assinam. */
async function enqueue(event, sessionName, data) {
    try {
        const sessionId = await sessionIdOf(sessionName);
        const hooks = await db().webhook.findMany({
            where: { active: true, legacy: false, OR: [{ sessionId: null }, ...(sessionId ? [{ sessionId }] : [])] }
        });
        const targets = hooks.filter(hook => Array.isArray(hook.events) && hook.events.includes(event));
        if (!targets.length) return 0;
        const payload = { event, session: sessionName || null, ...data };
        await db().webhookDelivery.createMany({
            data: targets.map(hook => ({ webhookId: hook.id, event, payload }))
        });
        worker.kick();
        return targets.length;
    } catch (error) {
        log.error({ err: error, event }, 'falha ao enfileirar webhook');
        return 0;
    }
}

const pickContact = contact =>
    contact && {
        id: contact.id,
        waId: contact.waId,
        name: contact.name,
        pushName: contact.pushName,
        tags: contact.tags
    };
const pickConversation = conversation =>
    conversation && {
        id: conversation.id,
        status: conversation.status,
        assignedUserId: conversation.assignedUserId,
        unreadCount: conversation.unreadCount
    };

const listeners = {
    'message.saved': ({ session, message, conversation, contact }) => {
        if (message.direction === 'note') return;
        const event = message.direction === 'in' ? 'message.received' : 'message.sent';
        return enqueue(event, session, {
            message,
            conversation: pickConversation(conversation),
            contact: pickContact(contact)
        });
    },
    'conversation.updated': ({ conversation }) =>
        enqueue('conversation.updated', conversation.session, {
            conversation: { ...pickConversation(conversation), assignedUser: conversation.assignedUser || null },
            contact: pickContact(conversation.contact)
        }),
    'conversation.handoff': async ({ conversationId, reason }) => {
        const conversation = await db().conversation.findUnique({
            where: { id: conversationId },
            include: { contact: true, session: { select: { name: true } } }
        });
        if (!conversation) return;
        return enqueue('conversation.handoff', conversation.session.name, {
            reason,
            conversation: pickConversation(conversation),
            contact: pickContact(conversation.contact)
        });
    },
    'session.state': ({ session, state }) => enqueue('session.state', session, { state })
};

// ---------- envio ----------

async function deliver(delivery, fetchImpl = globalThis.fetch) {
    const hook = delivery.webhook;
    const timestamp = Math.floor(Date.now() / 1000);
    const body = JSON.stringify({
        id: delivery.id,
        event: delivery.event,
        createdAt: delivery.createdAt,
        data: delivery.payload
    });
    const headers = {
        'Content-Type': 'application/json',
        'User-Agent': 'ConectZap-Webhooks/' + version,
        'X-ConectZap-Event': delivery.event,
        'X-ConectZap-Delivery': String(delivery.id),
        'X-ConectZap-Timestamp': String(timestamp)
    };
    if (hook.secret) headers['X-ConectZap-Signature'] = sign(hook.secret, timestamp, body);

    const started = Date.now();
    let status = null;
    let error = null;
    try {
        const response = await fetchImpl(hook.url, {
            method: 'POST',
            headers,
            body,
            signal: AbortSignal.timeout(TIMEOUT_MS)
        });
        status = response.status;
        if (!response.ok) error = 'HTTP ' + response.status;
    } catch (failure) {
        error = (failure.cause && failure.cause.code) || failure.message;
    }
    const attempts = delivery.attempts + 1;
    const durationMs = Date.now() - started;
    const data = { attempts, lastStatus: status, lastError: error, durationMs };
    if (!error) {
        Object.assign(data, { status: 'success', deliveredAt: new Date() });
    } else if (attempts >= MAX_ATTEMPTS) {
        data.status = 'failed';
    } else {
        data.nextAttemptAt = new Date(Date.now() + BACKOFF_SECONDS[attempts - 1] * 1000);
    }
    const updated = await db().webhookDelivery.update({ where: { id: delivery.id }, data });
    events.emit('webhook.delivered', { delivery: updated, ok: !error });
    if (error) log.warn({ webhook: hook.id, delivery: delivery.id, attempts, error }, 'webhook falhou');
    return updated;
}

const worker = {
    timer: null,
    running: false,
    lastCleanup: 0,
    fetch: undefined,

    /** Processa as entregas vencidas (uma rodada). */
    async tick() {
        if (this.running) return;
        this.running = true;
        try {
            const due = await db().webhookDelivery.findMany({
                where: { status: 'pending', nextAttemptAt: { lte: new Date() } },
                include: { webhook: true },
                orderBy: { id: 'asc' },
                take: BATCH
            });
            await Promise.all(due.map(delivery => deliver(delivery, this.fetch)));
            if (Date.now() - this.lastCleanup > 3600000) {
                this.lastCleanup = Date.now();
                await db().webhookDelivery.deleteMany({
                    where: { createdAt: { lt: new Date(Date.now() - RETENTION_DAYS * 86400000) } }
                });
            }
            if (due.length === BATCH) setImmediate(() => this.tick());
        } catch (error) {
            log.error({ err: error }, 'erro no envio de webhooks');
        } finally {
            this.running = false;
        }
    },

    kick() {
        if (this.timer) setImmediate(() => this.tick());
    },

    start(intervalMs = 2000) {
        if (this.timer) return;
        for (const [name, listener] of Object.entries(listeners)) events.on(name, listener);
        this.timer = setInterval(() => this.tick(), intervalMs);
        this.timer.unref();
        this.tick();
    },

    stop() {
        clearInterval(this.timer);
        this.timer = null;
        for (const [name, listener] of Object.entries(listeners)) events.off(name, listener);
    }
};

module.exports = {
    EVENTS,
    MAX_ATTEMPTS,
    BACKOFF_SECONDS,
    newSecret,
    sign,
    enqueue,
    deliver,
    worker,
    listeners,
    _sessionIds: sessionIds
};
