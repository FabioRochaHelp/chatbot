'use strict';

const { z } = require('zod');
const { db } = require('../../db');
const events = require('../../events');
const presence = require('../../presence');
const distributor = require('../../distributor');
const { AppError } = require('../../errors');
const { MODES } = require('../../departments');
const { ROLES } = require('./router');
const { idParams } = require('./schemas');

const tags = ['Departamentos'];
const name = z.string().trim().min(1).max(60);
const mode = z
    .enum(MODES)
    .describe('esteira: o atendente escolhe na fila; distribuida: rodízio entre os atendentes disponíveis');
const userIds = z.array(z.number().int().positive()).max(500).describe('atendentes do departamento');

const WITH_MEMBERS = {
    members: { include: { user: { select: { id: true, name: true, role: true, active: true, available: true } } } }
};

/** Departamento com atendentes (on-line = painel aberto + disponível) e conversas na fila. */
async function view(department, userId) {
    const pending = await db().conversation.count({ where: { departmentId: department.id, status: 'pending' } });
    const { members, ...rest } = department;
    return {
        ...rest,
        pending,
        mine: members.some(member => member.userId === userId),
        members: members
            .map(({ user, lastAssignedAt }) => ({
                ...user,
                lastAssignedAt,
                online: user.active && user.available && presence.isConnected(user.id)
            }))
            .sort((a, b) => a.name.localeCompare(b.name))
    };
}

async function ensureUsers(ids) {
    const found = await db().user.count({ where: { id: { in: ids } } });
    if (found !== new Set(ids).size) throw new AppError(400, 'INVALID_USER', 'atendente inexistente');
}

module.exports = function departmentRoutes({ define }) {
    async function find(id) {
        const department = await db().department.findUnique({ where: { id }, include: WITH_MEMBERS });
        if (!department) throw new AppError(404, 'DEPARTMENT_NOT_FOUND', 'departamento não encontrado');
        return department;
    }

    async function ensureFree(value, exceptId) {
        const existing = await db().department.findUnique({ where: { name: value } });
        if (existing && existing.id !== exceptId) throw new AppError(409, 'NAME_TAKEN', 'já existe com esse nome');
    }

    function changed(department) {
        events.emit('departments.changed', { departmentId: department.id });
        return department;
    }

    define(
        {
            method: 'get',
            path: '/departments',
            tags,
            summary: 'Lista departamentos',
            description: 'Todos os papéis (para transferir). mine = o usuário é atendente do departamento.',
            query: z.object({ active: z.enum(['true', 'false', 'all']).default('true') })
        },
        async ({ query }, req) => {
            const where = query.active === 'all' ? {} : { active: query.active === 'true' };
            const rows = await db().department.findMany({ where, include: WITH_MEMBERS, orderBy: { name: 'asc' } });
            const userId = req.principal.user && req.principal.user.id;
            return Promise.all(rows.map(row => view(row, userId)));
        }
    );

    define(
        {
            method: 'post',
            path: '/departments',
            status: 201,
            tags,
            roles: ROLES.manage,
            summary: 'Cria departamento',
            body: z.object({ name, mode: mode.default('esteira'), userIds: userIds.default([]) })
        },
        async ({ body }, req) => {
            await ensureFree(body.name);
            await ensureUsers(body.userIds);
            const created = await db().department.create({
                data: {
                    name: body.name,
                    mode: body.mode,
                    members: { create: [...new Set(body.userIds)].map(userId => ({ userId })) }
                }
            });
            changed(created);
            return view(await find(created.id), req.principal.user && req.principal.user.id);
        }
    );

    define(
        {
            method: 'patch',
            path: '/departments/:id',
            tags,
            roles: ROLES.manage,
            summary: 'Altera departamento (nome, modo, ativo, atendentes)',
            description:
                'userIds substitui a lista de atendentes. Desativar move a fila do departamento para ' +
                '"Sem departamento"; passar para distribuida já distribui o que estiver na fila.',
            params: idParams,
            body: z.object({
                name: name.optional(),
                mode: mode.optional(),
                active: z.boolean().optional(),
                userIds: userIds.optional()
            })
        },
        async ({ params, body }, req) => {
            const current = await find(params.id);
            if (body.name) await ensureFree(body.name, params.id);
            const { userIds: ids, ...data } = body;
            if (ids) await ensureUsers(ids);
            await db().$transaction(async tx => {
                await tx.department.update({ where: { id: params.id }, data });
                if (ids) {
                    const keep = [...new Set(ids)];
                    // mantém o ponteiro do rodízio de quem continua
                    await tx.departmentUser.deleteMany({ where: { departmentId: params.id, userId: { notIn: keep } } });
                    const existing = new Set(current.members.map(member => member.userId));
                    const added = keep.filter(userId => !existing.has(userId));
                    if (added.length) {
                        await tx.departmentUser.createMany({
                            data: added.map(userId => ({ departmentId: params.id, userId }))
                        });
                    }
                }
                if (body.active === false && current.active) {
                    await tx.conversation.updateMany({
                        where: { departmentId: params.id, status: 'pending' },
                        data: { departmentId: null }
                    });
                }
            });
            changed(current);
            if (body.active === false && current.active) events.emit('conversations.changed', {});
            await distributor.dispatch(params.id);
            return view(await find(params.id), req.principal.user && req.principal.user.id);
        }
    );

    define(
        {
            method: 'delete',
            path: '/departments/:id',
            tags,
            roles: ROLES.manage,
            summary: 'Remove departamento',
            description: 'As conversas do departamento vão para "Sem departamento".',
            params: idParams
        },
        async ({ params }) => {
            const department = await find(params.id);
            await db().department.delete({ where: { id: params.id } });
            changed(department);
            events.emit('conversations.changed', {});
            return { ok: true };
        }
    );
};
