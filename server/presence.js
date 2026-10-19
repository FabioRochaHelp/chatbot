'use strict';

const events = require('./events');

/**
 * Quem está com o painel aberto: conexões do socket por usuário (em memória, um processo só).
 * Recarregar a página derruba e refaz a conexão; a carência evita tirar o atendente do rodízio.
 * Para receber conversas distribuídas o atendente também precisa estar "Disponível" (User.available).
 *
 * Emite presence.changed { userId, connected }.
 */
const sockets = new Map();
const leaving = new Map();
const state = { graceMs: 30000 };

function connected(userId) {
    sockets.set(userId, (sockets.get(userId) || 0) + 1);
    if (leaving.has(userId)) {
        // voltou dentro da carência: para o rodízio nunca saiu
        clearTimeout(leaving.get(userId));
        leaving.delete(userId);
        return;
    }
    if (sockets.get(userId) === 1) events.emit('presence.changed', { userId, connected: true });
}

function disconnected(userId) {
    const count = (sockets.get(userId) || 1) - 1;
    if (count > 0) return sockets.set(userId, count);
    sockets.delete(userId);
    if (leaving.has(userId)) return;
    const timer = setTimeout(() => {
        leaving.delete(userId);
        if (!sockets.has(userId)) events.emit('presence.changed', { userId, connected: false });
    }, state.graceMs);
    if (timer.unref) timer.unref();
    leaving.set(userId, timer);
}

/** Painel aberto (ou dentro da carência). */
function isConnected(userId) {
    return sockets.has(userId) || leaving.has(userId);
}

function connectedIds() {
    return [...new Set([...sockets.keys(), ...leaving.keys()])];
}

/** Zera tudo (testes). */
function reset() {
    for (const timer of leaving.values()) clearTimeout(timer);
    sockets.clear();
    leaving.clear();
}

module.exports = { connected, disconnected, isConnected, connectedIds, reset, state };
