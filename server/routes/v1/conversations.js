'use strict';

const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { db } = require('../../db');
const messaging = require('../../messaging');
const history = require('../../history');
const events = require('../../events');
const { AppError } = require('../../errors');
const { pagination } = require('./router');
const schemas = require('./schemas');

const listConversations = z.object({
    session: z.string().optional().describe('nome da sessão'),
    status: schemas.status.optional(),
    contact: z.coerce.number().int().positive().optional().describe('id do contato'),
    q: z.string().max(100).optional().describe('busca por nome ou número do contato'),
    ...pagination
});
const listMessages = z.object({
    before: z.coerce.number().int().positive().optional().describe('id da mensagem: retorna as anteriores'),
    limit: pagination.limit
});
const listContacts = z.object({
    session: z.string().optional(),
    q: z.string().max(100).optional(),
    ...pagination
});

function contactSearch(q) {
    return { OR: [{ name: { contains: q } }, { pushName: { contains: q } }, { waId: { contains: q } }] };
}

const withContact = {
    contact: true,
    session: { select: { name: true } },
    messages: { orderBy: { id: 'desc' }, take: 1 }
};

function conversationView(conversation) {
    const { messages, session, ...rest } = conversation;
    return { ...rest, session: session.name, lastMessage: messages[0] || null };
}

module.exports = function conversationRoutes({ define }, { Sessions }) {
    async function findConversation(id) {
        const conversation = await db().conversation.findUnique({ where: { id }, include: withContact });
        if (!conversation) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'conversa não encontrada');
        return conversation;
    }

    define(
        {
            method: 'get',
            path: '/conversations',
            tags: ['Conversas'],
            summary: 'Lista conversas (mais recentes primeiro)',
            query: listConversations
        },
        async ({ query }) => {
            const where = {
                ...(query.session ? { session: { name: query.session } } : {}),
                ...(query.status ? { status: query.status } : {}),
                ...(query.contact ? { contactId: query.contact } : {}),
                ...(query.q ? { contact: contactSearch(query.q) } : {})
            };
            const [rows, total] = await Promise.all([
                db().conversation.findMany({
                    where,
                    include: withContact,
                    orderBy: [{ lastMessageAt: 'desc' }, { id: 'desc' }],
                    take: query.limit,
                    skip: query.offset
                }),
                db().conversation.count({ where })
            ]);
            return { data: rows.map(conversationView), meta: { total, limit: query.limit, offset: query.offset } };
        }
    );

    define(
        {
            method: 'get',
            path: '/conversations/:id',
            tags: ['Conversas'],
            summary: 'Detalhe da conversa',
            params: schemas.idParams
        },
        async ({ params }) => conversationView(await findConversation(params.id))
    );

    define(
        {
            method: 'patch',
            path: '/conversations/:id',
            tags: ['Conversas'],
            summary: 'Altera status ou marca como lida',
            params: schemas.idParams,
            body: schemas.updateConversation
        },
        async ({ params, body }) => {
            await findConversation(params.id);
            const data = {};
            if (body.status) {
                data.status = body.status;
                data.closedAt = body.status === 'closed' ? new Date() : null;
            }
            if (body.read) data.unreadCount = 0;
            await db().conversation.update({ where: { id: params.id }, data });
            const conversation = conversationView(await findConversation(params.id));
            events.emit('conversation.updated', { conversation });
            return conversation;
        }
    );

    define(
        {
            method: 'get',
            path: '/conversations/:id/messages',
            tags: ['Conversas'],
            summary: 'Mensagens da conversa (ordem cronológica)',
            description: 'Retorna as últimas "limit" mensagens; use before=<id da mais antiga> para paginar.',
            params: schemas.idParams,
            query: listMessages
        },
        async ({ params, query }) => {
            await findConversation(params.id);
            const rows = await db().message.findMany({
                where: { conversationId: params.id, ...(query.before ? { id: { lt: query.before } } : {}) },
                orderBy: { id: 'desc' },
                take: query.limit + 1
            });
            const hasMore = rows.length > query.limit;
            return { data: rows.slice(0, query.limit).reverse(), meta: { hasMore } };
        }
    );

    define(
        {
            method: 'post',
            path: '/conversations/:id/messages',
            status: 201,
            tags: ['Conversas'],
            summary: 'Responde na conversa',
            params: schemas.idParams,
            body: schemas.content
        },
        async ({ params, body }) => {
            const conversation = await findConversation(params.id);
            return messaging.send(
                Sessions,
                conversation.session.name,
                { ...body, to: conversation.contact.waId },
                { origin: 'api' }
            );
        }
    );

    define(
        { method: 'get', path: '/contacts', tags: ['Contatos'], summary: 'Lista contatos', query: listContacts },
        async ({ query }) => {
            const where = {
                ...(query.session ? { session: { name: query.session } } : {}),
                ...(query.q ? contactSearch(query.q) : {})
            };
            const [rows, total] = await Promise.all([
                db().contact.findMany({ where, orderBy: { id: 'desc' }, take: query.limit, skip: query.offset }),
                db().contact.count({ where })
            ]);
            return { data: rows, meta: { total, limit: query.limit, offset: query.offset } };
        }
    );

    async function findContact(id) {
        const contact = await db().contact.findUnique({ where: { id } });
        if (!contact) throw new AppError(404, 'CONTACT_NOT_FOUND', 'contato não encontrado');
        return contact;
    }

    define(
        {
            method: 'get',
            path: '/contacts/:id',
            tags: ['Contatos'],
            summary: 'Detalhe do contato',
            params: schemas.idParams
        },
        ({ params }) => findContact(params.id)
    );

    define(
        {
            method: 'patch',
            path: '/contacts/:id',
            tags: ['Contatos'],
            summary: 'Altera nome e tags do contato',
            params: schemas.idParams,
            body: schemas.updateContact
        },
        async ({ params, body }) => {
            await findContact(params.id);
            const contact = await db().contact.update({ where: { id: params.id }, data: body });
            events.emit('contact.updated', { contact });
            return contact;
        }
    );

    async function findMessage(id) {
        const message = await db().message.findUnique({ where: { id } });
        if (!message) throw new AppError(404, 'MESSAGE_NOT_FOUND', 'mensagem não encontrada');
        return message;
    }

    define(
        {
            method: 'get',
            path: '/messages/:id',
            tags: ['Mensagens'],
            summary: 'Detalhe da mensagem',
            params: schemas.idParams
        },
        ({ params }) => findMessage(params.id)
    );

    define(
        {
            method: 'get',
            path: '/messages/:id/media',
            tags: ['Mensagens'],
            summary: 'Baixa a mídia da mensagem',
            params: schemas.idParams
        },
        async ({ params }, req, res) => {
            const message = await findMessage(params.id);
            const file = history.mediaAbsolutePath(message.mediaPath);
            if (!file || !fs.existsSync(file)) {
                throw new AppError(404, 'MEDIA_NOT_FOUND', 'mensagem sem mídia gravada');
            }
            if (message.mimeType) res.type(message.mimeType.split(';')[0]);
            const fileName = encodeURIComponent(message.fileName || path.basename(file));
            res.setHeader('Content-Disposition', "inline; filename*=UTF-8''" + fileName);
            await new Promise((resolve, reject) => res.sendFile(file, error => (error ? reject(error) : resolve())));
        }
    );
};
