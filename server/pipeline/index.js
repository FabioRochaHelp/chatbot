'use strict';

const { Prisma } = require('@prisma/client');
const { db } = require('../db');
const events = require('../events');
const log = require('../logger');
const messaging = require('../messaging');
const flows = require('./flows');
const { botActive } = require('../bot-mode');

// uma mensagem por vez em cada conversa (respostas rápidas em sequência não se atropelam)
const queues = new Map();
function serialize(key, task) {
    const previous = queues.get(key) || Promise.resolve();
    const current = previous.then(task, task);
    queues.set(
        key,
        current.catch(() => null)
    );
    current.finally(() => {
        if (queues.get(key) === current) queues.delete(key);
    });
    return current;
}

const REPLY_GAP_MS = 400;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

/** Texto que o bot considera como resposta (legenda em mídia). */
function inputText(message) {
    return message.body || message.caption || '';
}

async function updateConversation(conversationId, data) {
    const conversation = await db().conversation.update({
        where: { id: conversationId },
        data,
        include: {
            contact: true,
            session: { select: { name: true } },
            assignedUser: { select: { id: true, name: true } }
        }
    });
    const { session, ...rest } = conversation;
    events.emit('conversation.updated', { conversation: { ...rest, session: session.name, lastMessage: null } });
    return conversation;
}

/**
 * Aplica os efeitos do fluxo: transferir, etiquetar, encerrar.
 */
async function applyEffects(conversation, effects) {
    const data = {};
    for (const effect of effects) {
        if (effect.type === 'tag') {
            const tags = Array.isArray(conversation.contact.tags) ? conversation.contact.tags : [];
            if (!tags.includes(effect.tag)) {
                const contact = await db().contact.update({
                    where: { id: conversation.contact.id },
                    data: { tags: [...tags, effect.tag] }
                });
                conversation.contact = contact;
                events.emit('contact.updated', { contact });
            }
        }
        if (effect.type === 'handoff') {
            data.status = 'pending';
            data.assignedUserId = null;
            events.emit('conversation.handoff', { conversationId: conversation.id, reason: effect.reason });
        }
        if (effect.type === 'end' && effect.close) {
            data.status = 'closed';
            data.closedAt = new Date();
        }
    }
    return data;
}

/**
 * Mensagem recebida já gravada no histórico: decide se o bot responde.
 * Só age em conversas com status "bot" em sessões com botMode que inclui "flow" e um fluxo publicado.
 */
function handle(Sessions, sessionName, message) {
    if (!message || message.direction !== 'in') return Promise.resolve(null);
    return serialize('conversation:' + message.conversationId, async () => {
        const conversation = await db().conversation.findUnique({
            where: { id: message.conversationId },
            include: { contact: true, session: { include: { flow: true } } }
        });
        if (!conversation || conversation.status !== 'bot') return null;
        const { session, contact } = conversation;
        if (!botActive(session) || contact.isGroup) {
            // bot desligado depois que a conversa começou (ou grupo): a conversa vai para a fila
            await updateConversation(conversation.id, { status: 'pending', flowState: Prisma.DbNull });
            return null;
        }
        // modo só IA: fica para a entrega da IA
        if (!session.botMode.includes('flow') || !session.flow || !session.flow.published) return null;

        let result;
        try {
            result = await flows.run(session.flow.published, conversation.flowState, inputText(message), {
                contact: { name: contact.name || contact.pushName || '', number: contact.waId.replace(/@.*/, '') }
            });
        } catch (error) {
            log.error({ err: error, conversation: conversation.id }, 'erro no fluxo: transferindo para atendente');
            result = { replies: [], effects: [{ type: 'handoff', reason: 'error' }], state: null };
        }

        for (const [index, text] of result.replies.entries()) {
            if (!text.trim()) continue;
            if (index > 0) await sleep(REPLY_GAP_MS);
            try {
                await messaging.send(
                    Sessions,
                    sessionName,
                    { type: 'text', to: contact.waId, text },
                    { origin: 'bot' }
                );
            } catch (error) {
                log.error({ err: error, conversation: conversation.id }, 'bot não conseguiu responder');
                break;
            }
        }

        // Json? no Prisma: null precisa ser DbNull
        const data = {
            flowState: result.state ?? Prisma.DbNull,
            ...(await applyEffects(conversation, result.effects))
        };
        await updateConversation(conversation.id, data);
        return result;
    });
}

module.exports = { handle, inputText };
