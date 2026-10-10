'use strict';

const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { db } = require('../../db');
const messaging = require('../../messaging');
const history = require('../../history');
const avatars = require('../../avatars');
const events = require('../../events');
const { AppError } = require('../../errors');
const { pagination } = require('./router');
const schemas = require('./schemas');

const listConversations = z.object({
    session: z.string().optional().describe('nome da sessão'),
    status: z
        .string()
        .regex(/^(bot|pending|open|closed)(,(bot|pending|open|closed))*$/)
        .optional()
        .describe('um ou mais status separados por vírgula, ex.: pending,open'),
    assigned: z
        .union([z.enum(['me', 'none']), z.coerce.number().int().positive()])
        .optional()
        .describe('me (minhas), none (sem atendente) ou id do usuário'),
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
    assignedUser: { select: { id: true, name: true } },
    messages: { where: { direction: { not: 'note' } }, orderBy: { id: 'desc' }, take: 1 }
};

function conversationView(conversation) {
    const { messages, session, ...rest } = conversation;
    return { ...rest, session: session.name, lastMessage: messages[0] || null };
}

/** Atendente ativo ou AppError. */
async function activeUser(id) {
    const user = await db().user.findUnique({ where: { id } });
    if (!user || !user.active) throw new AppError(400, 'INVALID_ASSIGNEE', 'atendente inexistente ou desativado');
    return user;
}

module.exports = function conversationRoutes({ define }, { Sessions }) {
    async function findConversation(id) {
        const conversation = await db().conversation.findUnique({ where: { id }, include: withContact });
        if (!conversation) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'conversa não encontrada');
        return conversation;
    }

    async function updateConversation(id, data) {
        await db().conversation.update({ where: { id }, data });
        const conversation = conversationView(await findConversation(id));
        events.emit('conversation.updated', { conversation });
        return conversation;
    }

    // marca como lida também no celular (melhor esforço: sessão pode estar desconectada)
    function sendSeen(conversation) {
        messaging
            .connectedClient(Sessions, conversation.session.name)
            .then(client => typeof client.sendSeen === 'function' && client.sendSeen(conversation.contact.waId))
            .catch(() => null);
    }

    define(
        {
            method: 'get',
            path: '/conversations',
            tags: ['Conversas'],
            summary: 'Lista conversas (mais recentes primeiro)',
            query: listConversations
        },
        async ({ query }, req) => {
            let assignedUserId;
            if (query.assigned === 'me') {
                if (!req.principal.user) throw new AppError(400, 'NOT_A_USER', 'assigned=me exige login de usuário');
                assignedUserId = req.principal.user.id;
            } else if (query.assigned === 'none') assignedUserId = null;
            else if (query.assigned) assignedUserId = query.assigned;
            const where = {
                ...(query.session ? { session: { name: query.session } } : {}),
                ...(query.status ? { status: { in: query.status.split(',') } } : {}),
                ...(assignedUserId !== undefined ? { assignedUserId } : {}),
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
            summary: 'Assume, transfere, devolve ao bot, encerra ou marca como lida',
            description:
                'status=open sem assignedUserId atribui a quem chamou. bot/pending tiram o atendente. ' +
                'Exemplos: assumir {status:"open"}; transferir {status:"open",assignedUserId:2}; ' +
                'devolver ao bot {status:"bot"}; encerrar {status:"closed"}.',
            params: schemas.idParams,
            body: schemas.updateConversation
        },
        async ({ params, body }, req) => {
            const current = await findConversation(params.id);
            const data = {};
            if (body.assignedUserId !== undefined) {
                if (body.assignedUserId !== null) await activeUser(body.assignedUserId);
                data.assignedUserId = body.assignedUserId;
            }
            if (body.status) {
                data.status = body.status;
                data.closedAt = body.status === 'closed' ? new Date() : null;
                if (body.status === 'bot' || body.status === 'pending') {
                    data.assignedUserId = null;
                } else if (body.status === 'open' && data.assignedUserId === undefined) {
                    if (req.principal.user) data.assignedUserId = req.principal.user.id;
                    else if (!current.assignedUserId) {
                        throw new AppError(400, 'ASSIGNEE_REQUIRED', 'informe assignedUserId para abrir o atendimento');
                    }
                }
            }
            if (body.read) {
                data.unreadCount = 0;
                sendSeen(current);
            }
            return updateConversation(params.id, data);
        }
    );

    define(
        {
            method: 'post',
            path: '/conversations/:id/notes',
            status: 201,
            tags: ['Conversas'],
            summary: 'Nota interna (não vai para o WhatsApp)',
            params: schemas.idParams,
            body: z.object({ text: z.string().trim().min(1).max(4000) })
        },
        async ({ params, body }, req) => {
            const conversation = await findConversation(params.id);
            return history.addNote(conversation, body.text, req.principal.user && req.principal.user.id);
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
                include: history.SENT_BY,
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
            description:
                'Resposta de um usuário do painel assume a conversa (status open) e reabre se estiver encerrada.',
            params: schemas.idParams,
            body: schemas.content
        },
        async ({ params, body }, req) => {
            const conversation = await findConversation(params.id);
            const user = req.principal.user;
            if (user && (conversation.status !== 'open' || !conversation.assignedUserId)) {
                // garante que a resposta caia nesta conversa (uma encerrada abriria outra)
                await updateConversation(conversation.id, {
                    status: 'open',
                    closedAt: null,
                    assignedUserId: conversation.assignedUserId || user.id
                });
            } else if (conversation.status === 'closed') {
                await updateConversation(conversation.id, { status: 'bot', closedAt: null });
            }
            return messaging.send(
                Sessions,
                conversation.session.name,
                { ...body, to: conversation.contact.waId },
                user ? { origin: 'agent', sentByUserId: user.id } : { origin: 'api' }
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

    define(
        {
            method: 'get',
            path: '/contacts/:id/avatar',
            tags: ['Contatos'],
            summary: 'Foto de perfil do contato (404 se não houver)',
            params: schemas.idParams
        },
        async ({ params }, req, res) => {
            const contact = await findContact(params.id);
            const file = history.mediaAbsolutePath(contact.avatarPath);
            if (!file || !fs.existsSync(file)) throw new AppError(404, 'AVATAR_NOT_FOUND', 'contato sem foto');
            // a URL leva ?v=<data da consulta>; dá para guardar em cache sem medo de foto velha
            res.setHeader('Cache-Control', 'private, max-age=86400');
            res.type('jpg');
            await new Promise((resolve, reject) => res.sendFile(file, error => (error ? reject(error) : resolve())));
        }
    );

    define(
        {
            method: 'post',
            path: '/contacts/:id/avatar/refresh',
            tags: ['Contatos'],
            summary: 'Busca de novo a foto de perfil no WhatsApp',
            description: 'A foto já é atualizada sozinha (no máximo uma vez por dia) quando o contato manda mensagem.',
            params: schemas.idParams
        },
        async ({ params }) => {
            const contact = await db().contact.findUnique({
                where: { id: params.id },
                include: { session: { select: { name: true } } }
            });
            if (!contact) throw new AppError(404, 'CONTACT_NOT_FOUND', 'contato não encontrado');
            const client = await messaging.connectedClient(Sessions, contact.session.name);
            await avatars.refresh(contact.session.name, contact, client);
            return findContact(params.id);
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
