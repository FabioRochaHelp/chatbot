'use strict';

const { z } = require('zod');
const { db } = require('../../db');
const { AppError } = require('../../errors');
const { ROLES } = require('./router');
const { idParams } = require('./schemas');

const tags = ['Respostas rápidas'];
const shortcut = z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9_-]{1,30}$/, 'use letras sem acento, números, hífen ou sublinhado (até 30)');
const text = z.string().trim().min(1).max(4000);

module.exports = function quickReplyRoutes({ define }) {
    async function find(id) {
        const reply = await db().quickReply.findUnique({ where: { id } });
        if (!reply) throw new AppError(404, 'QUICK_REPLY_NOT_FOUND', 'resposta rápida não encontrada');
        return reply;
    }

    async function ensureFree(value, exceptId) {
        const existing = await db().quickReply.findUnique({ where: { shortcut: value } });
        if (existing && existing.id !== exceptId) throw new AppError(409, 'SHORTCUT_TAKEN', 'atalho já existe');
    }

    define({ method: 'get', path: '/quick-replies', tags, summary: 'Lista respostas rápidas' }, () =>
        db().quickReply.findMany({ orderBy: { shortcut: 'asc' } })
    );

    define(
        {
            method: 'post',
            path: '/quick-replies',
            status: 201,
            tags,
            roles: ROLES.admin,
            summary: 'Cria resposta rápida',
            body: z.object({ shortcut, text })
        },
        async ({ body }) => {
            await ensureFree(body.shortcut);
            return db().quickReply.create({ data: body });
        }
    );

    define(
        {
            method: 'patch',
            path: '/quick-replies/:id',
            tags,
            roles: ROLES.admin,
            summary: 'Altera resposta rápida',
            params: idParams,
            body: z.object({ shortcut: shortcut.optional(), text: text.optional() })
        },
        async ({ params, body }) => {
            await find(params.id);
            if (body.shortcut) await ensureFree(body.shortcut, params.id);
            return db().quickReply.update({ where: { id: params.id }, data: body });
        }
    );

    define(
        {
            method: 'delete',
            path: '/quick-replies/:id',
            tags,
            roles: ROLES.admin,
            summary: 'Remove resposta rápida',
            params: idParams
        },
        async ({ params }) => {
            await find(params.id);
            await db().quickReply.delete({ where: { id: params.id } });
            return { ok: true };
        }
    );
};
