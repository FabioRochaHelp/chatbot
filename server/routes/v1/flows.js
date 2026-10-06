'use strict';

const { z } = require('zod');
const { db } = require('../../db');
const { AppError } = require('../../errors');
const flows = require('../../pipeline/flows');
const { TEMPLATES } = require('../../pipeline/templates');
const { ROLES } = require('./router');
const { idParams } = require('./schemas');

const tags = ['Fluxos'];
const roles = ROLES.manage;

const definition = z.object({
    nodes: z
        .array(
            z.object({
                id: z.string().min(1).max(64),
                type: z.enum(flows.NODE_TYPES),
                position: z.object({ x: z.number(), y: z.number() }),
                data: z.record(z.string(), z.any()).default({})
            })
        )
        .max(300),
    edges: z
        .array(
            z.object({
                id: z.string().min(1).max(200),
                source: z.string().min(1),
                target: z.string().min(1),
                sourceHandle: z.string().nullable().optional()
            })
        )
        .max(1000),
    settings: z
        .object({
            timeoutMinutes: z.number().int().min(1).max(1440).optional(),
            handoffKeywords: z.array(z.string().max(50)).max(20).optional(),
            handoffText: z.string().max(1000).optional()
        })
        .default({})
});

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function summary(flow) {
    return {
        id: flow.id,
        name: flow.name,
        description: flow.description,
        version: flow.version,
        publishedAt: flow.publishedAt,
        updatedAt: flow.updatedAt,
        // rascunho diferente do que está no ar
        draftChanged: !flow.published || !same(flow.definition, flow.published),
        sessions: (flow.sessions || []).map(session => session.name)
    };
}

module.exports = function flowRoutes({ define }) {
    async function find(id) {
        const flow = await db().flow.findUnique({ where: { id }, include: { sessions: { select: { name: true } } } });
        if (!flow) throw new AppError(404, 'FLOW_NOT_FOUND', 'fluxo não encontrado');
        return flow;
    }
    const full = flow => ({ ...summary(flow), definition: flow.definition, published: flow.published });

    define({ method: 'get', path: '/flows', tags, roles, summary: 'Lista fluxos' }, async () =>
        (
            await db().flow.findMany({
                orderBy: { updatedAt: 'desc' },
                include: { sessions: { select: { name: true } } }
            })
        ).map(summary)
    );

    define(
        {
            method: 'post',
            path: '/flows',
            status: 201,
            tags,
            roles,
            summary: 'Cria fluxo',
            description: 'template: blank (só boas-vindas) ou menu (exemplo com horário, menu e transferência).',
            body: z.object({
                name: z.string().trim().min(1).max(100),
                description: z.string().max(500).optional(),
                template: z.enum(['blank', 'menu']).default('blank')
            })
        },
        async ({ body }) => {
            const flow = await db().flow.create({
                data: { name: body.name, description: body.description, definition: TEMPLATES[body.template]() },
                include: { sessions: { select: { name: true } } }
            });
            return full(flow);
        }
    );

    define(
        {
            method: 'get',
            path: '/flows/:id',
            tags,
            roles,
            summary: 'Fluxo com rascunho e versão publicada',
            params: idParams
        },
        async ({ params }) => full(await find(params.id))
    );

    define(
        {
            method: 'patch',
            path: '/flows/:id',
            tags,
            roles,
            summary: 'Salva o rascunho (não afeta as sessões até publicar)',
            params: idParams,
            body: z.object({
                name: z.string().trim().min(1).max(100).optional(),
                description: z.string().max(500).nullable().optional(),
                definition: definition.optional()
            })
        },
        async ({ params, body }) => {
            await find(params.id);
            await db().flow.update({ where: { id: params.id }, data: body });
            return full(await find(params.id));
        }
    );

    define(
        {
            method: 'post',
            path: '/flows/:id/publish',
            tags,
            roles,
            summary: 'Publica o rascunho',
            description: 'Valida o fluxo; com erros responde 422 (details.errors). Avisos não impedem.',
            params: idParams
        },
        async ({ params }) => {
            const flow = await find(params.id);
            const { errors, warnings } = flows.validate(flow.definition);
            if (errors.length) {
                throw new AppError(422, 'FLOW_INVALID', 'o fluxo tem problemas que impedem publicar', {
                    details: { errors, warnings }
                });
            }
            await db().flow.update({
                where: { id: flow.id },
                data: { published: flow.definition, version: { increment: 1 }, publishedAt: new Date() }
            });
            return { ...full(await find(flow.id)), warnings };
        }
    );

    define(
        {
            method: 'post',
            path: '/flows/validate',
            tags,
            roles,
            summary: 'Valida uma definição sem salvar',
            body: z.object({ definition })
        },
        ({ body }) => flows.validate(body.definition)
    );

    define(
        {
            method: 'post',
            path: '/flows/simulate',
            tags,
            roles,
            summary: 'Simula uma mensagem no fluxo (sem WhatsApp)',
            description:
                'Envie a definição (pode ser o rascunho), o estado devolvido na chamada anterior e o texto. ' +
                'Esperas são ignoradas; requisições HTTP são feitas de verdade.',
            body: z.object({
                definition,
                state: z.any().optional(),
                input: z.string().max(4096).default(''),
                contact: z
                    .object({
                        name: z.string().max(100).default('Cliente'),
                        number: z.string().max(20).default('5511999999999')
                    })
                    .default({})
            })
        },
        ({ body }) =>
            flows.run(
                body.definition,
                body.state || null,
                body.input,
                { contact: body.contact },
                { sleep: async () => undefined }
            )
    );

    define(
        { method: 'delete', path: '/flows/:id', tags, roles, summary: 'Remove fluxo', params: idParams },
        async ({ params }) => {
            const flow = await find(params.id);
            if (flow.sessions.length) {
                throw new AppError(
                    409,
                    'FLOW_IN_USE',
                    'fluxo em uso pelas sessões: ' + flow.sessions.map(session => session.name).join(', ')
                );
            }
            await db().flow.delete({ where: { id: flow.id } });
            return { ok: true };
        }
    );
};
