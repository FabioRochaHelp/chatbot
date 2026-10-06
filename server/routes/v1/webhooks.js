'use strict';

const { z } = require('zod');
const { db } = require('../../db');
const { AppError } = require('../../errors');
const webhooks = require('../../webhooks');
const { ROLES } = require('./router');
const { idParams } = require('./schemas');
const { sessionName } = require('../../schemas');

const tags = ['Webhooks'];
const roles = ROLES.manage;

const fields = {
    url: z.url({ protocol: /^https?$/ }).max(2000),
    session: sessionName.nullable().describe('nome da sessão; null = todas'),
    events: z.array(z.enum(webhooks.EVENTS)).min(1).max(webhooks.EVENTS.length),
    active: z.boolean()
};

async function sessionIdFor(name) {
    if (!name) return null;
    const session = await db().session.findUnique({ where: { name } });
    if (!session) throw new AppError(400, 'SESSION_NOT_FOUND', 'sessão não encontrada: ' + name);
    return session.id;
}

/** Visão do webhook com a última entrega; o segredo só aparece no detalhe. */
async function view(hook, { withSecret = false } = {}) {
    const last = await db().webhookDelivery.findFirst({ where: { webhookId: hook.id }, orderBy: { id: 'desc' } });
    const failed = await db().webhookDelivery.count({ where: { webhookId: hook.id, status: 'failed' } });
    const { secret, session, ...rest } = hook;
    return {
        ...rest,
        session: session ? session.name : null,
        hasSecret: Boolean(secret),
        ...(withSecret ? { secret } : {}),
        lastDelivery: last
            ? {
                  id: last.id,
                  event: last.event,
                  status: last.status,
                  lastStatus: last.lastStatus,
                  createdAt: last.createdAt
              }
            : null,
        failedDeliveries: failed
    };
}

module.exports = function webhookRoutes({ define }) {
    async function find(id) {
        const hook = await db().webhook.findUnique({ where: { id }, include: { session: { select: { name: true } } } });
        if (!hook) throw new AppError(404, 'WEBHOOK_NOT_FOUND', 'webhook não encontrado');
        return hook;
    }

    define(
        { method: 'get', path: '/webhooks/events', tags, roles, summary: 'Eventos disponíveis' },
        () => webhooks.EVENTS
    );

    define(
        { method: 'get', path: '/webhooks', tags, roles, summary: 'Lista webhooks (inclui os antigos de /sendHook)' },
        async () => {
            const hooks = await db().webhook.findMany({
                orderBy: { id: 'asc' },
                include: { session: { select: { name: true } } }
            });
            return Promise.all(hooks.map(hook => view(hook)));
        }
    );

    define(
        {
            method: 'post',
            path: '/webhooks',
            status: 201,
            tags,
            roles,
            summary: 'Cria webhook',
            description: 'O segredo da assinatura é gerado e devolvido na resposta (e em GET /webhooks/:id).',
            body: z.object({
                url: fields.url,
                session: fields.session.default(null),
                events: fields.events.default(['message.received']),
                active: fields.active.default(true)
            })
        },
        async ({ body }) => {
            const hook = await db().webhook.create({
                data: {
                    url: body.url,
                    sessionId: await sessionIdFor(body.session),
                    events: body.events,
                    active: body.active,
                    secret: webhooks.newSecret()
                },
                include: { session: { select: { name: true } } }
            });
            return view(hook, { withSecret: true });
        }
    );

    define(
        { method: 'get', path: '/webhooks/:id', tags, roles, summary: 'Detalhe (com o segredo)', params: idParams },
        async ({ params }) => view(await find(params.id), { withSecret: true })
    );

    define(
        {
            method: 'patch',
            path: '/webhooks/:id',
            tags,
            roles,
            summary: 'Altera webhook',
            description: 'rotateSecret: true gera um segredo novo (o antigo deixa de valer na hora).',
            params: idParams,
            body: z.object({
                url: fields.url.optional(),
                session: fields.session.optional(),
                events: fields.events.optional(),
                active: fields.active.optional(),
                rotateSecret: z.literal(true).optional()
            })
        },
        async ({ params, body }) => {
            const hook = await find(params.id);
            if (hook.legacy && (body.events || body.rotateSecret || body.session !== undefined)) {
                throw new AppError(
                    409,
                    'LEGACY_WEBHOOK',
                    'webhook antigo (/sendHook): só dá para mudar a URL, ativar ou remover'
                );
            }
            const data = {};
            if (body.url) data.url = body.url;
            if (body.events) data.events = body.events;
            if (body.active !== undefined) data.active = body.active;
            if (body.session !== undefined) data.sessionId = await sessionIdFor(body.session);
            if (body.rotateSecret) data.secret = webhooks.newSecret();
            await db().webhook.update({ where: { id: hook.id }, data });
            return view(await find(hook.id), { withSecret: true });
        }
    );

    define(
        { method: 'delete', path: '/webhooks/:id', tags, roles, summary: 'Remove webhook', params: idParams },
        async ({ params }) => {
            const hook = await find(params.id);
            await db().webhook.delete({ where: { id: hook.id } });
            return { ok: true };
        }
    );

    define(
        {
            method: 'get',
            path: '/webhooks/:id/deliveries',
            tags,
            roles,
            summary: 'Entregas recentes (últimos 7 dias)',
            params: idParams,
            query: z.object({
                status: z.enum(['pending', 'success', 'failed']).optional(),
                limit: z.coerce.number().int().min(1).max(100).default(50)
            })
        },
        async ({ params, query }) => {
            await find(params.id);
            return db().webhookDelivery.findMany({
                where: { webhookId: params.id, ...(query.status ? { status: query.status } : {}) },
                orderBy: { id: 'desc' },
                take: query.limit
            });
        }
    );

    define(
        {
            method: 'post',
            path: '/webhooks/:id/test',
            status: 201,
            tags,
            roles,
            summary: 'Envia um evento "ping" de teste',
            params: idParams
        },
        async ({ params }) => {
            const hook = await find(params.id);
            if (hook.legacy) throw new AppError(409, 'LEGACY_WEBHOOK', 'webhook antigo não recebe eventos de teste');
            const delivery = await db().webhookDelivery.create({
                data: { webhookId: hook.id, event: 'ping', payload: { message: 'Teste do MyZap' } }
            });
            webhooks.worker.kick();
            return delivery;
        }
    );

    define(
        {
            method: 'post',
            path: '/webhook-deliveries/:id/retry',
            tags,
            roles,
            summary: 'Reenvia uma entrega agora',
            params: idParams
        },
        async ({ params }) => {
            const delivery = await db().webhookDelivery.findUnique({ where: { id: params.id } });
            if (!delivery) throw new AppError(404, 'DELIVERY_NOT_FOUND', 'entrega não encontrada');
            const updated = await db().webhookDelivery.update({
                where: { id: delivery.id },
                data: { status: 'pending', nextAttemptAt: new Date(), attempts: 0 }
            });
            webhooks.worker.kick();
            return updated;
        }
    );
};
