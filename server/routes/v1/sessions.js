'use strict';

const { db } = require('../../db');
const messaging = require('../../messaging');
const { AppError } = require('../../errors');
const schemas = require('./schemas');
const { ROLES } = require('./router');
const events = require('../../events');
const { botActive } = require('../../bot-mode');
const { Prisma } = require('@prisma/client');

const tags = ['Sessões'];
const WITH_FLOW = {
    flow: { select: { id: true, name: true, version: true, published: true } },
    aiAgent: { select: { id: true, name: true, model: true } }
};
// atendentes só consultam; criar, conectar, fechar e enviar avulso é de admin/integração
const manage = ROLES.manage;

function view(row, memory) {
    return {
        name: (row || memory).name,
        state: memory ? memory.state : 'CLOSED',
        engine: row ? row.engine : null,
        autoStart: row ? row.autoStart : null,
        botMode: row ? row.botMode : 'off',
        flow: row && row.flow ? { id: row.flow.id, name: row.flow.name, version: row.flow.version } : null,
        aiAgent: row && row.aiAgent ? row.aiAgent : null,
        acceptGroups: row ? row.acceptGroups : false,
        hasQrcode: Boolean(memory && memory.state === 'QRCODE' && memory.qrcode),
        createdAt: row ? row.createdAt : null,
        updatedAt: row ? row.updatedAt : null
    };
}

module.exports = function sessionRoutes({ define }, { Sessions }) {
    async function find(name) {
        const row = await db().session.findUnique({ where: { name }, include: WITH_FLOW });
        const memory = Sessions.getSession(name) || null;
        if (!row && !memory) throw new AppError(404, 'SESSION_NOT_FOUND', 'sessão não encontrada');
        return { row, memory };
    }

    async function current(name) {
        const { row, memory } = await find(name);
        return view(row, memory);
    }

    define({ method: 'get', path: '/sessions', tags, summary: 'Lista as sessões' }, async () => {
        const rows = await db().session.findMany({ orderBy: { id: 'asc' }, include: WITH_FLOW });
        const names = new Set(rows.map(row => row.name));
        return [
            ...rows.map(row => view(row, Sessions.getSession(row.name) || null)),
            ...Sessions.getSessions()
                .filter(session => !names.has(session.name))
                .map(session => view(null, session))
        ];
    });

    define(
        {
            method: 'post',
            roles: manage,
            path: '/sessions',
            status: 201,
            tags,
            summary: 'Cria e inicia uma sessão',
            description: 'Idempotente: se a sessão já existe, só garante que está iniciada e aplica as opções.',
            body: schemas.createSession
        },
        async ({ body }) => {
            await Sessions.start(body.name);
            await db().session.update({
                where: { name: body.name },
                data: { autoStart: body.autoStart }
            });
            return current(body.name);
        }
    );

    define(
        { method: 'get', path: '/sessions/:name', tags, summary: 'Detalhe da sessão', params: schemas.sessionParams },
        ({ params }) => current(params.name)
    );

    define(
        {
            method: 'patch',
            roles: manage,
            path: '/sessions/:name',
            tags,
            summary: 'Altera opções da sessão',
            params: schemas.sessionParams,
            body: schemas.updateSession
        },
        async ({ params, body }) => {
            const { row } = await find(params.name);
            if (!row) throw new AppError(404, 'SESSION_NOT_FOUND', 'sessão não encontrada no banco');
            if (body.flowId) {
                const flow = await db().flow.findUnique({ where: { id: body.flowId } });
                if (!flow) throw new AppError(400, 'FLOW_NOT_FOUND', 'fluxo não encontrado');
            }
            if (body.aiAgentId) {
                const agent = await db().aiAgent.findUnique({ where: { id: body.aiAgentId } });
                if (!agent) throw new AppError(400, 'AI_AGENT_NOT_FOUND', 'assistente de IA não encontrado');
            }
            const botMode = body.botMode ?? row.botMode;
            const flowId = body.flowId !== undefined ? body.flowId : row.flowId;
            const aiAgentId = body.aiAgentId !== undefined ? body.aiAgentId : row.aiAgentId;
            if (botMode === 'flow' && !flowId) {
                throw new AppError(400, 'FLOW_REQUIRED', 'escolha um fluxo para ligar o bot de fluxo');
            }
            if (botMode === 'ai' && !aiAgentId) {
                throw new AppError(400, 'AI_AGENT_REQUIRED', 'escolha um assistente de IA para ligar a IA');
            }
            const updated = await db().session.update({ where: { name: params.name }, data: body, include: WITH_FLOW });
            if (body.acceptGroups === false && row.acceptGroups) {
                // grupos fora do Atendimento: encerra as conversas de grupo abertas (o histórico fica)
                const closed = await db().conversation.updateMany({
                    where: { sessionId: updated.id, status: { not: 'closed' }, contact: { isGroup: true } },
                    data: { status: 'closed', closedAt: new Date(), flowState: Prisma.DbNull }
                });
                if (closed.count) events.emit('conversations.changed', { session: params.name });
            }
            if (!botActive(updated)) {
                // bot desligado: quem estava com o bot vai para a fila
                const moved = await db().conversation.updateMany({
                    where: { sessionId: updated.id, status: 'bot' },
                    data: { status: 'pending', flowState: Prisma.DbNull }
                });
                if (moved.count) events.emit('conversations.changed', { session: params.name });
            }
            return current(params.name);
        }
    );

    define(
        {
            method: 'post',
            roles: manage,
            path: '/sessions/:name/start',
            tags,
            summary: 'Inicia (ou reconecta) a sessão',
            params: schemas.sessionParams
        },
        async ({ params }) => {
            await Sessions.start(params.name);
            return current(params.name);
        }
    );

    define(
        {
            method: 'post',
            roles: manage,
            path: '/sessions/:name/close',
            tags,
            summary: 'Fecha a sessão',
            description: 'Também desliga o autoStart: a sessão não volta quando o servidor reiniciar.',
            params: schemas.sessionParams
        },
        async ({ params }) => {
            const { memory } = await find(params.name);
            if (memory) await Sessions.closeSession(params.name);
            await db().session.updateMany({ where: { name: params.name }, data: { autoStart: false } });
            return current(params.name);
        }
    );

    define(
        {
            method: 'get',
            roles: manage,
            path: '/sessions/:name/qrcode',
            tags,
            summary: 'QR code para conectar',
            description: 'format=png devolve a imagem; 409 se a sessão não está aguardando leitura.',
            params: schemas.sessionParams,
            query: schemas.qrcodeQuery
        },
        async ({ params, query }, req, res) => {
            const memory = Sessions.getSession(params.name);
            if (!memory) throw new AppError(404, 'SESSION_NOT_FOUND', 'sessão não iniciada');
            if (memory.state !== 'QRCODE' || !memory.qrcode) {
                throw new AppError(409, 'QRCODE_NOT_AVAILABLE', 'sem QR code no momento', {
                    details: { state: memory.state }
                });
            }
            if (query.format === 'json') return { state: memory.state, qrcode: memory.qrcode };
            const image = Buffer.from(memory.qrcode.replace(/^data:image\/png;base64,/, ''), 'base64');
            res.type('png').send(image);
        }
    );

    define(
        {
            method: 'post',
            roles: manage,
            path: '/sessions/:name/messages',
            status: 201,
            tags: ['Mensagens'],
            summary: 'Envia uma mensagem',
            description: 'Tipos: text, file, voice, location, link, contact. Retorna a mensagem gravada no histórico.',
            params: schemas.sessionParams,
            body: schemas.sendMessage
        },
        ({ params, body }) => messaging.send(Sessions, params.name, body, { origin: 'api' })
    );

    define(
        {
            method: 'get',
            path: '/sessions/:name/numbers/:number',
            tags: ['Mensagens'],
            summary: 'Verifica se o número tem WhatsApp',
            params: schemas.numberParams
        },
        async ({ params }) => {
            const client = await messaging.connectedClient(Sessions, params.name);
            return client.checkNumberStatus(params.number);
        }
    );
};
