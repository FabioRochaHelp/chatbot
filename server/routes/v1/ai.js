'use strict';

const { z } = require('zod');
const { db } = require('../../db');
const { AppError } = require('../../errors');
const ai = require('../../pipeline/ai');
const log = require('../../logger');
const { ROLES } = require('./router');
const { idParams } = require('./schemas');

const tags = ['IA'];
const roles = ROLES.manage;

const fields = {
    name: z.string().trim().min(1).max(100),
    model: z.enum(Object.keys(ai.MODELS)),
    effort: z.enum(['low', 'medium', 'high']),
    instructions: z.string().max(20000),
    knowledge: z.string().max(200000).describe('base de conhecimento (texto livre)'),
    historyMessages: z.number().int().min(2).max(100),
    maxRepliesPerHour: z.number().int().min(1).max(500)
};

const STARTER_INSTRUCTIONS = [
    'Atenda com simpatia e objetividade.',
    'Pergunte o nome do cliente se ainda não souber.',
    'Para pedidos, reclamações, trocas e pagamentos, transfira para um atendente.'
].join('\n');

const DAY = 24 * 3600 * 1000;

async function usageSummary(agentId) {
    const since = new Date(Date.now() - 30 * DAY);
    const rows = await db().aiUsage.findMany({ where: { agentId, test: false, createdAt: { gte: since } } });
    const total = {
        replies: 0,
        handoffs: 0,
        errors: 0,
        inputTokens: 0,
        outputTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        costUsd: 0
    };
    for (const row of rows) {
        if (row.outcome === 'reply' || row.outcome === 'end') total.replies += 1;
        if (row.outcome === 'handoff' || row.outcome === 'limit' || row.outcome === 'refusal') total.handoffs += 1;
        if (row.outcome === 'error') total.errors += 1;
        total.inputTokens += row.inputTokens;
        total.outputTokens += row.outputTokens;
        total.cacheReadTokens += row.cacheReadTokens;
        total.cacheWriteTokens += row.cacheWriteTokens;
        total.costUsd += ai.estimateCost(row.model, row);
    }
    total.costUsd = Math.round(total.costUsd * 10000) / 10000;
    return total;
}

/** Fluxos (rascunho ou publicado) com bloco de IA apontando para o assistente. */
async function flowsUsing(agentId) {
    const flows = await db().flow.findMany({ select: { name: true, definition: true, published: true } });
    const uses = definition =>
        (definition?.nodes || []).some(node => node.type === 'ai' && node.data?.agentId === agentId);
    return flows.filter(flow => uses(flow.definition) || uses(flow.published)).map(flow => flow.name);
}

function apiError(error) {
    const Anthropic = require('@anthropic-ai/sdk').default;
    if (error instanceof Anthropic.AuthenticationError)
        return new AppError(502, 'AI_AUTH', 'chave da Anthropic inválida (ANTHROPIC_API_KEY)');
    if (error instanceof Anthropic.RateLimitError)
        return new AppError(429, 'AI_RATE_LIMIT', 'limite de uso da API da Anthropic; tente em instantes');
    if (error instanceof Anthropic.APIConnectionError) {
        return new AppError(
            502,
            'AI_CONNECTION',
            'não foi possível conectar à API da Anthropic (internet ou firewall do servidor)'
        );
    }
    if (error instanceof Anthropic.APIError) {
        return new AppError(502, 'AI_ERROR', 'erro na API da Anthropic: ' + error.message);
    }
    return error;
}

module.exports = function aiRoutes({ define }) {
    async function find(id) {
        const agent = await db().aiAgent.findUnique({
            where: { id },
            include: { sessions: { select: { name: true } } }
        });
        if (!agent) throw new AppError(404, 'AI_AGENT_NOT_FOUND', 'assistente não encontrado');
        return agent;
    }
    const view = async agent => ({
        ...agent,
        sessions: agent.sessions.map(session => session.name),
        usage: await usageSummary(agent.id)
    });

    define({ method: 'get', path: '/ai/status', tags, roles, summary: 'IA configurada? Modelos disponíveis' }, () => ({
        available: ai.available(),
        defaultModel: ai.DEFAULT_MODEL,
        models: Object.entries(ai.MODELS).map(([id, model]) => ({ id, ...model }))
    }));

    define(
        {
            method: 'get',
            path: '/ai-agents',
            tags,
            roles,
            summary: 'Lista assistentes de IA (com uso dos últimos 30 dias)'
        },
        async () => {
            const agents = await db().aiAgent.findMany({
                orderBy: { id: 'asc' },
                include: { sessions: { select: { name: true } } }
            });
            return Promise.all(agents.map(view));
        }
    );

    define(
        {
            method: 'post',
            path: '/ai-agents',
            status: 201,
            tags,
            roles,
            summary: 'Cria assistente de IA',
            body: z.object({ name: fields.name, model: fields.model.optional(), effort: fields.effort.optional() })
        },
        async ({ body }) =>
            view(
                await db().aiAgent.create({
                    data: { ...body, instructions: STARTER_INSTRUCTIONS },
                    include: { sessions: { select: { name: true } } }
                })
            )
    );

    define(
        { method: 'get', path: '/ai-agents/:id', tags, roles, summary: 'Detalhe do assistente', params: idParams },
        async ({ params }) => view(await find(params.id))
    );

    define(
        {
            method: 'patch',
            path: '/ai-agents/:id',
            tags,
            roles,
            summary: 'Altera o assistente (vale na próxima mensagem)',
            params: idParams,
            body: z.object(Object.fromEntries(Object.entries(fields).map(([key, schema]) => [key, schema.optional()])))
        },
        async ({ params, body }) => {
            await find(params.id);
            await db().aiAgent.update({ where: { id: params.id }, data: body });
            return view(await find(params.id));
        }
    );

    define(
        { method: 'delete', path: '/ai-agents/:id', tags, roles, summary: 'Remove assistente', params: idParams },
        async ({ params }) => {
            const agent = await find(params.id);
            const flows = await flowsUsing(agent.id);
            const inUse = [
                ...agent.sessions.map(session => 'sessão ' + session.name),
                ...flows.map(name => 'fluxo ' + name)
            ];
            if (inUse.length) throw new AppError(409, 'AI_AGENT_IN_USE', 'assistente em uso: ' + inUse.join(', '));
            await db().aiAgent.delete({ where: { id: agent.id } });
            return { ok: true };
        }
    );

    define(
        {
            method: 'post',
            path: '/ai-agents/test',
            tags,
            roles,
            summary: 'Testa o assistente (playground)',
            description:
                'Envie a configuração (pode ser um rascunho não salvo) e a conversa. Chama a API da Anthropic de verdade (custo real); ' +
                'nada é enviado ao WhatsApp. Com agentId, o uso entra na conta do assistente como teste.',
            body: z.object({
                agentId: z.number().int().positive().optional(),
                agent: z.object({
                    model: fields.model.default(ai.DEFAULT_MODEL),
                    effort: fields.effort.default('low'),
                    instructions: fields.instructions.default(''),
                    knowledge: fields.knowledge.default('')
                }),
                contactName: z.string().max(100).default('Cliente'),
                messages: z
                    .array(z.object({ direction: z.enum(['in', 'out']), body: z.string().min(1).max(4000) }))
                    .min(1)
                    .max(50)
            })
        },
        async ({ body }) => {
            if (!ai.available())
                throw new AppError(503, 'AI_UNAVAILABLE', 'defina ANTHROPIC_API_KEY no servidor para usar a IA');
            const history = body.messages.map(message => ({ ...message, type: 'chat' }));
            let result;
            try {
                result = await ai.respond(body.agent, history, { contact: { name: body.contactName } });
            } catch (error) {
                log.warn({ err: error }, 'teste da IA falhou');
                throw apiError(error);
            }
            await db().aiUsage.create({
                data: {
                    agentId: body.agentId || null,
                    model: result.usage.model,
                    inputTokens: result.usage.inputTokens,
                    outputTokens: result.usage.outputTokens,
                    cacheReadTokens: result.usage.cacheReadTokens,
                    cacheWriteTokens: result.usage.cacheWriteTokens,
                    outcome: result.outcome,
                    test: true
                }
            });
            return {
                ...result,
                usage: { ...result.usage, costUsd: ai.estimateCost(result.usage.model, result.usage) }
            };
        }
    );
};
