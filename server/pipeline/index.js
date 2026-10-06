'use strict';

const { Prisma } = require('@prisma/client');
const { db } = require('../db');
const events = require('../events');
const log = require('../logger');
const messaging = require('../messaging');
const flows = require('./flows');
const { botActive } = require('../bot-mode');
const history = require('../history');
const ai = require('./ai');

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

const AI_OUTCOME_TO_HANDOFF = {
    error: 'erro ao chamar a IA',
    refusal: 'a IA não pôde responder',
    limit: 'limite de respostas da IA'
};

/** Atende com o assistente de IA. Devolve { replies, effects, state } no mesmo formato do fluxo. */
async function runAi(conversation, agentId) {
    const keep = { mode: 'ai', agentId, updatedAt: new Date().toISOString() };
    const handoff = (reason, note) => ({ replies: [], effects: [{ type: 'handoff', reason, note }], state: null });

    const agent = agentId ? await db().aiAgent.findUnique({ where: { id: agentId } }) : null;
    if (!agent) return handoff('ai-unavailable', 'assistente de IA não encontrado');
    if (!ai.available()) return handoff('ai-unavailable', 'IA sem ANTHROPIC_API_KEY configurada');

    const recent = await db().aiUsage.count({
        where: { conversationId: conversation.id, test: false, createdAt: { gte: new Date(Date.now() - 3600000) } }
    });
    if (recent >= agent.maxRepliesPerHour) return handoff('limit', AI_OUTCOME_TO_HANDOFF.limit);

    const history = (
        await db().message.findMany({
            where: { conversationId: conversation.id, direction: { not: 'note' } },
            orderBy: { id: 'desc' },
            take: agent.historyMessages
        })
    ).reverse();
    const contact = { name: conversation.contact.name || conversation.contact.pushName || '' };

    let result;
    try {
        result = await ai.respond(agent, history, { contact });
    } catch (error) {
        log.error({ err: error, conversation: conversation.id }, 'falha na IA: transferindo para atendente');
        result = {
            replies: [],
            effects: [{ type: 'handoff', reason: 'error' }],
            usage: { model: agent.model },
            outcome: 'error'
        };
    }
    const { usage } = result;
    await db().aiUsage.create({
        data: {
            agentId: agent.id,
            conversationId: conversation.id,
            model: usage.model || agent.model,
            inputTokens: usage.inputTokens || 0,
            outputTokens: usage.outputTokens || 0,
            cacheReadTokens: usage.cacheReadTokens || 0,
            cacheWriteTokens: usage.cacheWriteTokens || 0,
            outcome: result.outcome
        }
    });
    const effects = result.effects.map(effect =>
        effect.type === 'handoff' && !effect.note && AI_OUTCOME_TO_HANDOFF[result.outcome]
            ? { ...effect, note: AI_OUTCOME_TO_HANDOFF[result.outcome] }
            : effect
    );
    const finished = effects.some(effect => effect.type === 'handoff' || effect.type === 'end');
    return { replies: result.replies, effects, state: finished ? null : keep };
}

/** Nota interna para o atendente quando a IA transfere ou encerra (com o motivo/resumo). */
async function noteEffects(conversation, effects) {
    for (const effect of effects) {
        if (!effect.note) continue;
        const prefix = effect.type === 'end' ? 'IA encerrou' : 'Transferido pelo bot';
        await history.addNote(conversation, `${prefix}: ${effect.note}`, null);
    }
}

/**
 * Mensagem recebida já gravada no histórico: decide se o bot responde.
 * Só age em conversas com status "bot". Modos: fluxo publicado, assistente de IA,
 * ou fluxo que passou a conversa para a IA (bloco "IA": flowState.mode = "ai").
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

        const flow = session.flow && session.flow.published;
        let state = conversation.flowState;
        // IA chamada por um fluxo: volta ao início do fluxo depois do tempo de inatividade
        if (state && state.mode === 'ai' && flow) {
            const timeout = ((flow.settings && flow.settings.timeoutMinutes) || 30) * 60000;
            if (Date.now() - new Date(state.updatedAt).getTime() > timeout) state = null;
        }

        let result;
        try {
            if (session.botMode === 'ai') {
                result = await runAi(conversation, session.aiAgentId);
            } else if (state && state.mode === 'ai') {
                result = await runAi(conversation, state.agentId);
            } else {
                result = await flows.run(flow, state, inputText(message), {
                    contact: { name: contact.name || contact.pushName || '', number: contact.waId.replace(/@.*/, '') }
                });
                const toAi = result.effects.find(effect => effect.type === 'ai');
                if (toAi) {
                    // o fluxo passou para a IA: ela já responde a mensagem atual
                    await sendReplies(Sessions, sessionName, contact, result.replies, conversation.id);
                    const answered = await runAi(conversation, toAi.agentId);
                    result = {
                        replies: answered.replies,
                        effects: [...result.effects.filter(effect => effect.type !== 'ai'), ...answered.effects],
                        state: answered.state
                    };
                    result.origin = 'ai';
                }
            }
        } catch (error) {
            log.error({ err: error, conversation: conversation.id }, 'erro no bot: transferindo para atendente');
            result = { replies: [], effects: [{ type: 'handoff', reason: 'error', note: 'erro no bot' }], state: null };
        }

        const aiAnswered = session.botMode === 'ai' || (state && state.mode === 'ai') || result.origin === 'ai';
        await sendReplies(Sessions, sessionName, contact, result.replies, conversation.id, aiAnswered ? 'ai' : 'bot');
        await noteEffects(conversation, result.effects);
        // Json? no Prisma: null precisa ser DbNull
        const data = {
            flowState: result.state ?? Prisma.DbNull,
            ...(await applyEffects(conversation, result.effects))
        };
        await updateConversation(conversation.id, data);
        return result;
    });
}

async function sendReplies(Sessions, sessionName, contact, replies, conversationId, origin = 'bot') {
    for (const [index, text] of replies.entries()) {
        if (!text.trim()) continue;
        if (index > 0) await sleep(REPLY_GAP_MS);
        try {
            await messaging.send(Sessions, sessionName, { type: 'text', to: contact.waId, text }, { origin });
        } catch (error) {
            log.error({ err: error, conversation: conversationId }, 'bot não conseguiu responder');
            break;
        }
    }
}

module.exports = { handle, inputText };
