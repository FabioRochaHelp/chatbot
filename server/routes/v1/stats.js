'use strict';

const { z } = require('zod');
const { db } = require('../../db');

const DAYS = 7;
const DAY_MS = 24 * 3600 * 1000;

const query = z.object({
    tzOffset: z.coerce
        .number()
        .int()
        .min(-840)
        .max(840)
        .default(0)
        .describe('Date.getTimezoneOffset() do navegador, para os dias baterem com o fuso do usuário')
});

/** Início do dia (no fuso do cliente) que contém "date", em UTC. */
function startOfDay(date, tzOffset) {
    const local = date.getTime() - tzOffset * 60000;
    return new Date(Math.floor(local / DAY_MS) * DAY_MS + tzOffset * 60000);
}

module.exports = function statsRoutes({ define }, { Sessions }) {
    define(
        {
            method: 'get',
            path: '/stats',
            tags: ['Painel'],
            summary: 'Números do painel',
            description: 'Sessões, conversas por status, não lidas e mensagens dos últimos 7 dias.',
            query
        },
        async ({ query: { tzOffset } }) => {
            const today = startOfDay(new Date(), tzOffset);
            const days = Array.from(
                { length: DAYS },
                (_, index) => new Date(today.getTime() - (DAYS - 1 - index) * DAY_MS)
            );
            const count = (from, direction) =>
                db().message.count({
                    where: { direction, timestamp: { gte: from, lt: new Date(from.getTime() + DAY_MS) } }
                });

            const [sessionsTotal, byStatus, unread, perDay] = await Promise.all([
                db().session.count(),
                db().conversation.groupBy({ by: ['status'], where: { status: { not: 'closed' } }, _count: true }),
                db().conversation.aggregate({ where: { status: { not: 'closed' } }, _sum: { unreadCount: true } }),
                Promise.all(days.map(async day => ({ in: await count(day, 'in'), out: await count(day, 'out') })))
            ]);
            const conversations = { bot: 0, pending: 0, open: 0 };
            for (const row of byStatus) conversations[row.status] = row._count;
            const memory = Sessions.getSessions();

            return {
                sessions: {
                    total: Math.max(sessionsTotal, memory.length),
                    connected: memory.filter(session => session.state === 'CONNECTED').length
                },
                conversations,
                unread: unread._sum.unreadCount || 0,
                messagesToday: perDay[DAYS - 1],
                messagesByDay: days.map((day, index) => ({
                    // data local do cliente (AAAA-MM-DD)
                    date: new Date(day.getTime() - tzOffset * 60000).toISOString().slice(0, 10),
                    ...perDay[index]
                }))
            };
        }
    );
};
