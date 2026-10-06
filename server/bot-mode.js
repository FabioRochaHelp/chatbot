'use strict';

/**
 * O bot responde nesta sessão? botMode: off | flow | ai | flow+ai.
 * "flow" só vale com um fluxo publicado; "ai" entra na entrega da IA.
 * session precisa vir com { botMode, flow: { published } }.
 */
function botActive(session) {
    if (!session || !session.botMode || session.botMode === 'off') return false;
    if (session.botMode.includes('ai')) return true;
    return Boolean(session.flow && session.flow.published);
}

const BOT_SESSION_SELECT = { botMode: true, flow: { select: { published: true } } };

module.exports = { botActive, BOT_SESSION_SELECT };
