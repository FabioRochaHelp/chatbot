'use strict';

const { db } = require('./db');
const events = require('./events');
const log = require('./logger');
const presence = require('./presence');
const departments = require('./departments');

/**
 * Departamentos distribuídos: entrega as conversas da fila (mais antiga primeiro) em rodízio
 * aos atendentes on-line (painel aberto + "Disponível"). O próximo é quem recebeu há mais tempo.
 * Sem ninguém on-line a conversa espera na fila; é entregue quando alguém ficar disponível.
 */

// um rodízio por vez em cada departamento
const chains = new Map();
function serialize(key, task) {
    const previous = chains.get(key) || Promise.resolve();
    const current = previous.then(task, task);
    const guarded = current.catch(() => null);
    chains.set(key, guarded);
    guarded.then(() => {
        if (chains.get(key) === guarded) chains.delete(key);
    });
    return current;
}

const VIEW = {
    contact: true,
    session: { select: { name: true } },
    assignedUser: { select: { id: true, name: true } },
    department: { select: { id: true, name: true, mode: true } }
};

const time = date => (date ? date.getTime() : -Infinity);

/** Próximo atendente do rodízio entre os membros on-line. */
async function nextMember(departmentId) {
    const members = await db().departmentUser.findMany({
        where: { departmentId, user: { active: true, available: true } }
    });
    const online = members.filter(member => presence.isConnected(member.userId));
    online.sort((a, b) => time(a.lastAssignedAt) - time(b.lastAssignedAt) || a.userId - b.userId);
    return { next: online[0], members };
}

async function assignAll(departmentId) {
    const department = await db().department.findUnique({ where: { id: departmentId } });
    if (!department || !department.active || department.mode !== 'distribuida') return 0;
    let assigned = 0;
    for (;;) {
        const conversation = await db().conversation.findFirst({
            where: { departmentId, status: 'pending', assignedUserId: null },
            orderBy: [{ queuedAt: 'asc' }, { id: 'asc' }]
        });
        if (!conversation) break;
        const { next, members } = await nextMember(departmentId);
        if (!next) break;
        // sempre depois do último entregue (duas entregas no mesmo milissegundo não empatam)
        const last = Math.max(...members.map(member => time(member.lastAssignedAt)));
        const now = new Date(Math.max(Date.now(), last + 1));
        const { count } = await db().conversation.updateMany({
            where: { id: conversation.id, departmentId, status: 'pending', assignedUserId: null },
            data: { status: 'open', assignedUserId: next.userId, closedAt: null }
        });
        if (!count) continue; // alguém assumiu antes: tenta a próxima
        await db().departmentUser.update({
            where: { departmentId_userId: { departmentId, userId: next.userId } },
            data: { lastAssignedAt: now }
        });
        assigned += 1;
        const view = await db().conversation.findUnique({ where: { id: conversation.id }, include: VIEW });
        const { session, ...rest } = view;
        const payload = { ...rest, session: session.name, lastMessage: null };
        events.emit('conversation.updated', { conversation: payload });
        events.emit('conversation.assigned', { conversation: payload, userId: next.userId });
    }
    return assigned;
}

/** Entrega o que estiver na fila do departamento (só age nos distribuídos). Devolve quantas entregou. */
function dispatch(departmentId) {
    if (!departmentId) return Promise.resolve(0);
    return serialize(departmentId, () => assignAll(departmentId)).catch(error => {
        log.error({ err: error, department: departmentId }, 'falha ao distribuir conversas');
        return 0;
    });
}

/** Distribui nos departamentos do usuário (ficou on-line ou disponível). */
async function drainFor(userId) {
    const ids = await departments.idsOf(userId);
    await Promise.all(ids.map(dispatch));
}

/** Espera os rodízios em andamento (testes). */
async function settled() {
    while (chains.size) await Promise.all([...chains.values()]);
}

events.on('presence.changed', ({ userId, connected }) => {
    if (connected) drainFor(userId).catch(() => null);
});

module.exports = { dispatch, drainFor, settled, VIEW };
