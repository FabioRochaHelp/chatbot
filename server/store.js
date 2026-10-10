'use strict';

const config = require('./config');
const { db } = require('./db');
const log = require('./logger');

// falha no banco não pode derrubar o WhatsApp: registra e segue com o fallback
async function safe(action, fallback, fn) {
    try {
        return await fn();
    } catch (error) {
        log.error({ err: error, action }, 'erro no banco');
        return fallback;
    }
}

module.exports = {
    // grava (ou reativa) a sessão: quem chama /start quer a sessão de volta após restart
    saveSession: name =>
        safe('saveSession', null, () =>
            db().session.upsert({
                where: { name },
                create: { name, engine: config.engine },
                update: { engine: config.engine, autoStart: true }
            })
        ),

    setAutoStart: (name, autoStart) =>
        safe('setAutoStart', null, () => db().session.updateMany({ where: { name }, data: { autoStart } })),

    setLastState: (name, lastState) =>
        safe('setLastState', null, () => db().session.updateMany({ where: { name }, data: { lastState } })),

    listAutoStart: () =>
        safe('listAutoStart', [], async () => {
            const sessions = await db().session.findMany({
                where: { autoStart: true },
                select: { name: true },
                orderBy: { id: 'asc' }
            });
            return sessions.map(session => session.name);
        }),

    // webhook da rota antiga /sendHook: no máximo um por sessão
    getLegacyHook: name =>
        safe('getLegacyHook', null, async () => {
            const webhook = await db().webhook.findFirst({
                where: { legacy: true, active: true, session: { name } },
                orderBy: { id: 'desc' }
            });
            return webhook ? webhook.url : null;
        }),

    saveLegacyHook: (name, url) =>
        safe('saveLegacyHook', null, () =>
            db().$transaction(async tx => {
                const session = await tx.session.upsert({
                    where: { name },
                    create: { name, engine: config.engine },
                    update: {}
                });
                await tx.webhook.deleteMany({ where: { sessionId: session.id, legacy: true } });
                if (url) await tx.webhook.create({ data: { sessionId: session.id, url, legacy: true } });
            })
        )
};
