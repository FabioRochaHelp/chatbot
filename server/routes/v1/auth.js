'use strict';

const { z } = require('zod');
const rateLimit = require('express-rate-limit');
const config = require('../../config');
const { db } = require('../../db');
const auth = require('../../auth');
const events = require('../../events');
const { errorBody } = require('../../http');
const { AppError } = require('../../errors');
const { ROLES } = require('./router');
const { idParams } = require('./schemas');

const email = z
    .email()
    .max(255)
    .transform(value => value.toLowerCase());
const password = z.string().min(8, 'mínimo de 8 caracteres').max(200);
const name = z.string().trim().min(1).max(100);
const role = z.enum(['admin', 'agent']);

const tags = ['Autenticação'];

// tentativas de login/setup por IP (só conta as que falham)
const loginLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    skipSuccessfulRequests: true,
    standardHeaders: 'draft-8',
    legacyHeaders: false,
    handler: (req, res, next, options) =>
        res.status(options.statusCode).json(errorBody(req, 'TOO_MANY_ATTEMPTS', 'muitas tentativas; aguarde'))
});

function setSessionCookie(res, token) {
    const cookie = auth.sessionCookie(token);
    res.cookie(cookie.name, cookie.value, cookie.options);
}

function me(principal) {
    return { type: principal.type, role: principal.role, user: auth.publicUser(principal.user) };
}

async function login(res, user) {
    const updated = await db().user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });
    setSessionCookie(res, await auth.signSession(updated));
    return auth.publicUser(updated);
}

/** Impede ficar sem nenhum admin ativo. */
async function ensureAnotherAdmin(userId) {
    const admins = await db().user.count({ where: { role: 'admin', active: true, id: { not: userId } } });
    if (admins === 0) throw new AppError(409, 'LAST_ADMIN', 'não é possível remover o último administrador');
}

module.exports = function authRoutes({ define }) {
    define(
        {
            method: 'get',
            path: '/auth/status',
            public: true,
            tags,
            summary: 'Situação da autenticação',
            description: 'setupRequired=true quando ainda não há usuários (use POST /auth/setup).'
        },
        async (input, req) => ({
            authRequired: await auth.authRequired(),
            setupRequired: (await db().user.count()) === 0,
            principal: req.principal ? me(req.principal) : null
        })
    );

    define(
        {
            method: 'post',
            path: '/auth/setup',
            public: true,
            status: 201,
            tags,
            summary: 'Cria o primeiro administrador',
            description: 'Só funciona sem usuários. Se API_TOKEN estiver definido, exige esse token.',
            body: z.object({ email, name, password }),
            middleware: [loginLimiter]
        },
        async ({ body }, req, res) => {
            if (config.apiToken && (!req.principal || req.principal.type !== 'master')) {
                throw new AppError(401, 'UNAUTHORIZED', 'informe o API_TOKEN para criar o primeiro usuário');
            }
            const user = await db().$transaction(async tx => {
                if ((await tx.user.count()) > 0) throw new AppError(409, 'SETUP_DONE', 'já existem usuários');
                const { password: plain, ...data } = body;
                return tx.user.create({
                    data: { ...data, role: 'admin', passwordHash: await auth.hashPassword(plain) }
                });
            });
            auth.refreshAuthState();
            return login(res, user);
        }
    );

    define(
        {
            method: 'post',
            path: '/auth/login',
            public: true,
            tags,
            summary: 'Entra no painel (cookie httpOnly)',
            body: z.object({ email, password: z.string().min(1).max(200) }),
            middleware: [loginLimiter]
        },
        async ({ body }, req, res) => {
            const user = await db().user.findUnique({ where: { email: body.email } });
            const valid = await auth.verifyPasswordOrDummy(body.password, user && user.passwordHash);
            if (!valid || !user.active) throw new AppError(401, 'INVALID_CREDENTIALS', 'e-mail ou senha inválidos');
            return login(res, user);
        }
    );

    define(
        { method: 'post', path: '/auth/logout', public: true, tags, summary: 'Sai do painel' },
        async (input, req, res) => {
            const cookie = auth.sessionCookie('');
            res.clearCookie(cookie.name, { ...cookie.options, maxAge: undefined });
            return { ok: true };
        }
    );

    define({ method: 'get', path: '/auth/me', tags, summary: 'Quem está autenticado' }, (input, req) =>
        me(req.principal)
    );

    define(
        {
            method: 'patch',
            path: '/auth/me',
            tags,
            summary: 'Altera o próprio nome ou senha',
            description: 'Trocar a senha encerra os outros logins.',
            body: z.object({
                name: name.optional(),
                currentPassword: z.string().max(200).optional(),
                newPassword: password.optional()
            })
        },
        async ({ body }, req, res) => {
            const user = req.principal.user;
            if (!user) throw new AppError(400, 'NOT_A_USER', 'só usuários do painel têm perfil');
            const data = {};
            if (body.name) data.name = body.name;
            if (body.newPassword) {
                if (!body.currentPassword || !(await auth.verifyPassword(body.currentPassword, user.passwordHash))) {
                    throw new AppError(400, 'INVALID_PASSWORD', 'senha atual incorreta');
                }
                data.passwordHash = await auth.hashPassword(body.newPassword);
                data.tokenVersion = { increment: 1 };
            }
            const updated = await db().user.update({ where: { id: user.id }, data });
            if (body.newPassword) {
                events.emit('user.revoked', { userId: user.id });
                setSessionCookie(res, await auth.signSession(updated));
            }
            return auth.publicUser(updated);
        }
    );

    // ---------- usuários ----------

    const users = { tags: ['Usuários'], roles: ROLES.admin };

    define({ method: 'get', path: '/users', ...users, summary: 'Lista usuários' }, async () =>
        (await db().user.findMany({ orderBy: { id: 'asc' } })).map(auth.publicUser)
    );

    define(
        {
            method: 'post',
            path: '/users',
            status: 201,
            ...users,
            summary: 'Cria usuário',
            body: z.object({ email, name, password, role: role.default('agent') })
        },
        async ({ body }) => {
            if (await db().user.findUnique({ where: { email: body.email } })) {
                throw new AppError(409, 'EMAIL_TAKEN', 'e-mail já cadastrado');
            }
            const { password: plain, ...data } = body;
            const user = await db().user.create({ data: { ...data, passwordHash: await auth.hashPassword(plain) } });
            auth.refreshAuthState();
            return auth.publicUser(user);
        }
    );

    define(
        {
            method: 'patch',
            path: '/users/:id',
            ...users,
            summary: 'Altera usuário',
            description: 'Mudar senha, papel ou desativar encerra os logins ativos do usuário.',
            params: idParams,
            body: z.object({
                name: name.optional(),
                role: role.optional(),
                active: z.boolean().optional(),
                password: password.optional()
            })
        },
        async ({ params, body }) => {
            const user = await db().user.findUnique({ where: { id: params.id } });
            if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'usuário não encontrado');
            const demoting = user.role === 'admin' && ((body.role && body.role !== 'admin') || body.active === false);
            if (demoting) await ensureAnotherAdmin(user.id);
            const { password: plain, ...data } = body;
            if (plain) data.passwordHash = await auth.hashPassword(plain);
            const revoke = Boolean(plain) || body.active === false || (body.role && body.role !== user.role);
            if (revoke) data.tokenVersion = { increment: 1 };
            const updated = await db().user.update({ where: { id: user.id }, data });
            if (revoke) events.emit('user.revoked', { userId: user.id });
            return auth.publicUser(updated);
        }
    );

    define(
        { method: 'delete', path: '/users/:id', ...users, summary: 'Remove usuário', params: idParams },
        async ({ params }, req) => {
            const user = await db().user.findUnique({ where: { id: params.id } });
            if (!user) throw new AppError(404, 'USER_NOT_FOUND', 'usuário não encontrado');
            if (req.principal.user && req.principal.user.id === user.id) {
                throw new AppError(409, 'CANNOT_DELETE_SELF', 'não é possível remover o próprio usuário');
            }
            if (user.role === 'admin') await ensureAnotherAdmin(user.id);
            await db().user.delete({ where: { id: user.id } });
            auth.refreshAuthState();
            events.emit('user.revoked', { userId: user.id });
            return { ok: true };
        }
    );

    define(
        {
            method: 'get',
            path: '/users/directory',
            tags: ['Usuários'],
            summary: 'Atendentes ativos (para transferir conversas)',
            description: 'Disponível para todos os papéis: só id, nome e papel.'
        },
        () =>
            db().user.findMany({
                where: { active: true },
                select: { id: true, name: true, role: true },
                orderBy: { name: 'asc' }
            })
    );

    // ---------- chaves de API ----------

    const keys = { tags: ['Chaves de API'], roles: ROLES.admin };
    const keyView = ({ keyHash, ...rest }) => rest;

    define({ method: 'get', path: '/api-keys', ...keys, summary: 'Lista chaves de API' }, async () =>
        (
            await db().apiKey.findMany({ orderBy: { id: 'desc' }, include: { createdBy: { select: { name: true } } } })
        ).map(keyView)
    );

    define(
        {
            method: 'post',
            path: '/api-keys',
            status: 201,
            ...keys,
            summary: 'Cria chave de API',
            description: 'A chave completa só aparece nesta resposta. Use em Authorization: Bearer <chave>.',
            body: z.object({ name })
        },
        async ({ body }, req) => {
            const { key, prefix, keyHash } = auth.generateApiKey();
            const apiKey = await db().apiKey.create({
                data: {
                    name: body.name,
                    prefix,
                    keyHash,
                    createdById: req.principal.user ? req.principal.user.id : null
                }
            });
            auth.refreshAuthState();
            return { ...keyView(apiKey), key };
        }
    );

    define(
        { method: 'delete', path: '/api-keys/:id', ...keys, summary: 'Revoga chave de API', params: idParams },
        async ({ params }) => {
            const apiKey = await db().apiKey.findUnique({ where: { id: params.id } });
            if (!apiKey) throw new AppError(404, 'API_KEY_NOT_FOUND', 'chave não encontrada');
            const revoked = await db().apiKey.update({
                where: { id: apiKey.id },
                data: { revokedAt: apiKey.revokedAt || new Date() }
            });
            auth.refreshAuthState();
            return keyView(revoked);
        }
    );
};
