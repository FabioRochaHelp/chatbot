'use strict';

/**
 * O bot responde nesta sessão? botMode: off | flow | ai.
 * "flow" só vale com um fluxo publicado; "ai" com um assistente escolhido.
 * session precisa vir com { botMode, aiAgentId, flow: { published } }.
 */
function botActive(session) {
    if (!session || !session.botMode) return false;
    if (session.botMode === 'ai') return Boolean(session.aiAgentId);
    if (session.botMode === 'flow') return Boolean(session.flow && session.flow.published);
    return false;
}

const BOT_SESSION_SELECT = { botMode: true, aiAgentId: true, flow: { select: { published: true } } };

module.exports = { botActive, BOT_SESSION_SELECT };
