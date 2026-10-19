'use strict';

const fs = require('fs');
const path = require('path');
const { z } = require('zod');
const { db } = require('../../db');
const messaging = require('../../messaging');
const history = require('../../history');
const avatars = require('../../avatars');
const events = require('../../events');
const departments = require('../../departments');
const distributor = require('../../distributor');
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
    department: z
        .union([z.literal('none'), z.coerce.number().int().positive()])
        .optional()
        .describe('id do departamento ou none ("Sem departamento")'),
    contact: z.coerce.number().int().positive().optional().describe('id do contato'),
    q: z.string().max(100).optional().describe('busca por nome ou número do contato'),
    sort: z
        .enum(['recent', 'queue'])
        .default('recent')
        .describe('recent: última mensagem primeiro; queue: ordem de chegada na fila (mais antiga primeiro)'),
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
    department: { select: { id: true, name: true, mode: true } },
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

/** O atendente não escolhe na fila de departamento distribuído: quem entrega é o rodízio. */
function ensureCanTake(conversation, principal) {
    const distributed = conversation.department && conversation.department.mode === 'distribuida';
    if (principal.role === 'agent' && conversation.status === 'pending' && distributed) {
        throw new AppError(
            403,
            'DISTRIBUTED_QUEUE',
            'a fila deste departamento é distribuída automaticamente entre os atendentes disponíveis'
        );
    }
}

module.exports = function conversationRoutes({ define }, { Sessions }) {
    /** Conversa visível para quem chamou (fora do escopo do atendente: 404). */
    async function findConversation(id, principal) {
        const scope = await departments.scopeFor(principal);
        const conversation = await db().conversation.findFirst({ where: { id, ...scope }, include: withContact });
        if (!conversation) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'conversa não encontrada');
        return conversation;
    }

    /**
     * Grava e avisa. Tirar da fila (assumir) só vale se ninguém assumiu antes: dois atendentes
     * clicando ao mesmo tempo, um recebe 409.
     */
    async function updateConversation(current, data) {
        const taking = current.status === 'pending' && data.status === 'open';
        if (taking) {
            const { count } = await db().conversation.updateMany({
                where: { id: current.id, status: 'pending', assignedUserId: null },
                data
            });
            if (!count) throw new AppError(409, 'ALREADY_ASSIGNED', 'a conversa já foi assumida por outro atendente');
        } else {
            await db().conversation.update({ where: { id: current.id }, data });
        }
        const conversation = conversationView(await findConversation(current.id));
        events.emit('conversation.updated', {
            conversation,
            previous: { departmentId: current.departmentId, assignedUserId: current.assignedUserId }
        });
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
            const scope = await departments.scopeFor(req.principal);
            let assignedUserId;
            if (query.assigned === 'me') {
                if (!req.principal.user) throw new AppError(400, 'NOT_A_USER', 'assigned=me exige login de usuário');
                assignedUserId = req.principal.user.id;
            } else if (query.assigned === 'none') assignedUserId = null;
            else if (query.assigned) assignedUserId = query.assigned;
            const where = {
                ...scope,
                ...(query.department ? { departmentId: query.department === 'none' ? null : query.department } : {}),
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
                    orderBy:
                        query.sort === 'queue'
                            ? [{ queuedAt: 'asc' }, { id: 'asc' }]
                            : [{ lastMessageAt: 'desc' }, { id: 'desc' }],
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
        async ({ params }, req) => conversationView(await findConversation(params.id, req.principal))
    );

    define(
        {
            method: 'patch',
            path: '/conversations/:id',
            tags: ['Conversas'],
            summary: 'Assume, transfere, devolve à fila ou ao bot, encerra ou marca como lida',
            description:
                'status=open sem assignedUserId atribui a quem chamou. bot/pending tiram o atendente. ' +
                'Exemplos: assumir {status:"open"}; transferir {status:"open",assignedUserId:2}; ' +
                'transferir para departamento {departmentId:3} (null = "Sem departamento"); ' +
                'devolver à fila {status:"pending"}; devolver ao bot {status:"bot"}; encerrar {status:"closed"}. ' +
                'Assumir conversa que já foi assumida: 409. Atendente não assume da fila de departamento ' +
                'distribuído (403).',
            params: schemas.idParams,
            body: schemas.updateConversation
        },
        async ({ params, body }, req) => {
            const current = await findConversation(params.id, req.principal);
            const data = {};
            let queueOf;
            if (body.departmentId !== undefined) {
                if ((body.status && body.status !== 'pending') || body.assignedUserId) {
                    throw new AppError(
                        400,
                        'INVALID_TRANSFER',
                        'transferir para departamento coloca a conversa na fila'
                    );
                }
                if (body.departmentId !== null && !(await departments.active(body.departmentId))) {
                    throw new AppError(400, 'INVALID_DEPARTMENT', 'departamento inexistente ou desativado');
                }
                queueOf = body.departmentId;
            } else if (body.status === 'pending') {
                // devolver à fila: a do mesmo departamento
                queueOf = current.departmentId;
            }
            if (queueOf !== undefined) {
                Object.assign(data, departments.queueFields(queueOf), { closedAt: null });
            } else if (body.assignedUserId !== undefined) {
                if (body.assignedUserId !== null) await activeUser(body.assignedUserId);
                data.assignedUserId = body.assignedUserId;
            }
            if (body.status === 'open') ensureCanTake(current, req.principal);
            if (body.status && queueOf === undefined) {
                data.status = body.status;
                data.closedAt = body.status === 'closed' ? new Date() : null;
                if (body.status === 'bot') {
                    data.assignedUserId = null;
                } else if (body.status === 'open' && data.assignedUserId === undefined) {
                    const user = req.principal.user;
                    // assumir não tira de outro atendente (para isso, transfira com assignedUserId)
                    if (
                        user &&
                        current.status === 'open' &&
                        current.assignedUserId &&
                        current.assignedUserId !== user.id
                    ) {
                        throw new AppError(409, 'ALREADY_ASSIGNED', 'a conversa já foi assumida por outro atendente');
                    }
                    if (user) data.assignedUserId = user.id;
                    else if (!current.assignedUserId) {
                        throw new AppError(400, 'ASSIGNEE_REQUIRED', 'informe assignedUserId para abrir o atendimento');
                    }
                }
            }
            if (body.read) {
                data.unreadCount = 0;
                sendSeen(current);
            }
            const conversation = await updateConversation(current, data);
            if (queueOf) {
                await distributor.dispatch(queueOf);
                return conversationView(await findConversation(current.id));
            }
            return conversation;
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
            const conversation = await findConversation(params.id, req.principal);
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
        async ({ params, query }, req) => {
            await findConversation(params.id, req.principal);
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
            const conversation = await findConversation(params.id, req.principal);
            const user = req.principal.user;
            if (user && (conversation.status !== 'open' || !conversation.assignedUserId)) {
                ensureCanTake(conversation, req.principal);
                // garante que a resposta caia nesta conversa (uma encerrada abriria outra)
                await updateConversation(conversation, {
                    status: 'open',
                    closedAt: null,
                    assignedUserId: conversation.assignedUserId || user.id
                });
            } else if (conversation.status === 'closed') {
                await updateConversation(conversation, { status: 'bot', closedAt: null });
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
            const { error } = await avatars.refresh(contact.session.name, contact, client);
            if (error) throw new AppError(502, 'AVATAR_FAILED', 'não foi possível buscar a foto: ' + error);
            return findContact(params.id);
        }
    );

    async function findMessage(id, principal) {
        const scope = await departments.scopeFor(principal);
        const message = await db().message.findFirst({ where: { id, conversation: scope } });
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
        ({ params }, req) => findMessage(params.id, req.principal)
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
            const message = await findMessage(params.id, req.principal);
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
