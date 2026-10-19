'use strict';

const { db } = require('./db');

/**
 * Departamentos: cada um tem seus atendentes e uma fila.
 * - esteira: o atendente escolhe na fila quem vai atender
 * - distribuida: o sistema entrega as conversas em rodízio aos atendentes disponíveis
 * Conversa sem departamento fica na fila "Sem departamento" (esteira, visível para todos).
 */
const MODES = ['esteira', 'distribuida'];

/** Departamento ativo ou null (inexistente/desativado vai para "Sem departamento"). */
async function active(id) {
    if (!id) return null;
    return db().department.findFirst({ where: { id, active: true } });
}

/** Campos para colocar a conversa na fila do departamento (null = "Sem departamento"). */
function queueFields(departmentId) {
    return { status: 'pending', assignedUserId: null, departmentId: departmentId || null, queuedAt: new Date() };
}

/** Ids dos departamentos do usuário. */
async function idsOf(userId) {
    const rows = await db().departmentUser.findMany({ where: { userId }, select: { departmentId: true } });
    return rows.map(row => row.departmentId);
}

/**
 * Filtro de conversas visíveis: o atendente vê os seus departamentos, a fila "Sem departamento"
 * e as conversas atribuídas a ele; admin e integrações veem tudo.
 */
async function scopeFor(principal) {
    if (!principal || principal.role !== 'agent' || !principal.user) return {};
    const ids = await idsOf(principal.user.id);
    return {
        OR: [{ departmentId: null }, { departmentId: { in: ids } }, { assignedUserId: principal.user.id }]
    };
}

/** Salas do socket que podem ver a conversa (ver realtime.js). */
function roomsOf(conversation) {
    if (!conversation) return ['all'];
    const rooms = conversation.departmentId ? ['managers', 'department:' + conversation.departmentId] : ['all'];
    if (conversation.assignedUserId) rooms.push('user:' + conversation.assignedUserId);
    return rooms;
}

module.exports = { MODES, active, queueFields, idsOf, scopeFor, roomsOf };
