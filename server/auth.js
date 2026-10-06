'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { promisify } = require('util');
const config = require('./config');
const { db } = require('./db');
const log = require('./logger');

const scrypt = promisify(crypto.scrypt);
const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };
const COOKIE = 'conectzap_session';
const API_KEY_PREFIX = 'czk_';
// chaves criadas quando o app se chamava MyZap continuam valendo
const LEGACY_API_KEY_PREFIXES = ['mzk_'];

// ---------- senha (scrypt nativo: sem módulo nativo para compilar) ----------

async function hashPassword(password) {
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(password, salt, SCRYPT.keylen, SCRYPT);
    return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$');
}

async function verifyPassword(password, stored) {
    const [algorithm, N, r, p, salt, hash] = String(stored).split('$');
    if (algorithm !== 'scrypt') return false;
    const expected = Buffer.from(hash, 'base64');
    const actual = await scrypt(password, Buffer.from(salt, 'base64'), expected.length, {
        N: Number(N),
        r: Number(r),
        p: Number(p)
    });
    return crypto.timingSafeEqual(actual, expected);
}

// hash fixo para gastar o mesmo tempo quando o e-mail não existe
let dummyHash = null;
async function verifyPasswordOrDummy(password, stored) {
    if (stored) return verifyPassword(password, stored);
    dummyHash = dummyHash || (await hashPassword(crypto.randomBytes(16).toString('hex')));
    await verifyPassword(password, dummyHash);
    return false;
}

// ---------- JWT do login (cookie httpOnly) ----------

let secretKey = null;

/** JWT_SECRET ou um segredo aleatório salvo em DATA_DIR (sobrevive a restart). */
function jwtSecret() {
    if (secretKey) return secretKey;
    let secret = config.jwtSecret;
    if (!secret) {
        const file = path.join(config.dataDir, 'jwt-secret');
        try {
            secret = fs.readFileSync(file, 'utf8').trim();
        } catch (error) {
            secret = crypto.randomBytes(48).toString('base64url');
            fs.mkdirSync(config.dataDir, { recursive: true });
            fs.writeFileSync(file, secret, { mode: 0o600 });
            log.info({ file }, 'JWT_SECRET não definido: segredo gerado e salvo');
        }
    }
    secretKey = new TextEncoder().encode(secret);
    return secretKey;
}

async function signSession(user) {
    const { SignJWT } = require('jose');
    return new SignJWT({ ver: user.tokenVersion })
        .setProtectedHeader({ alg: 'HS256' })
        .setSubject(String(user.id))
        .setIssuedAt()
        .setExpirationTime(config.sessionTtlHours + 'h')
        .sign(jwtSecret());
}

async function userFromSession(token) {
    try {
        const { jwtVerify } = require('jose');
        const { payload } = await jwtVerify(token, jwtSecret(), { algorithms: ['HS256'] });
        const user = await db().user.findUnique({ where: { id: Number(payload.sub) } });
        if (!user || !user.active || user.tokenVersion !== payload.ver) return null;
        return user;
    } catch (error) {
        return null;
    }
}

function sessionCookie(token) {
    return {
        name: COOKIE,
        value: token,
        options: {
            httpOnly: true,
            // Strict: o navegador não manda o cookie em requisições de outros sites (CSRF)
            sameSite: 'strict',
            secure: config.cookieSecure,
            path: '/',
            maxAge: config.sessionTtlHours * 3600 * 1000
        }
    };
}

function parseCookies(header) {
    const cookies = {};
    for (const part of String(header || '').split(';')) {
        const index = part.indexOf('=');
        if (index < 0) continue;
        const name = part.slice(0, index).trim();
        try {
            cookies[name] = decodeURIComponent(part.slice(index + 1).trim());
        } catch (error) {
            // cookie malformado: ignora
        }
    }
    return cookies;
}

// ---------- chaves de API ----------

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');

function generateApiKey() {
    const key = API_KEY_PREFIX + crypto.randomBytes(32).toString('base64url');
    return { key, prefix: key.slice(0, API_KEY_PREFIX.length + 6), keyHash: sha256(key) };
}

async function apiKeyFromToken(token) {
    if (![API_KEY_PREFIX, ...LEGACY_API_KEY_PREFIXES].some(prefix => token.startsWith(prefix))) return null;
    const apiKey = await db().apiKey.findUnique({ where: { keyHash: sha256(token) } });
    if (!apiKey || apiKey.revokedAt) return null;
    // atualiza no máximo uma vez por minuto
    if (!apiKey.lastUsedAt || Date.now() - apiKey.lastUsedAt.getTime() > 60000) {
        db()
            .apiKey.update({ where: { id: apiKey.id }, data: { lastUsedAt: new Date() } })
            .catch(() => null);
    }
    return apiKey;
}

// ---------- quem está chamando ----------

function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Autenticação é exigida se houver API_TOKEN, algum usuário ou alguma chave ativa.
 * Sem nada disso a API fica aberta, como nas versões antigas (com aviso no log).
 */
let authRequiredCache = null;
async function authRequired() {
    if (config.apiToken) return true;
    if (authRequiredCache === null) {
        const [users, keys] = await Promise.all([db().user.count(), db().apiKey.count({ where: { revokedAt: null } })]);
        authRequiredCache = users + keys > 0;
    }
    return authRequiredCache;
}

function refreshAuthState() {
    authRequiredCache = null;
}

/**
 * Principal: { type: master | apikey | user | open, role: admin | agent | integration, user?, apiKey? }.
 * credentials: { bearer, cookie, queryToken }.
 */
async function resolvePrincipal({ bearer, cookie, queryToken }) {
    const token = bearer || queryToken;
    if (token) {
        if (config.apiToken && safeEqual(token, config.apiToken)) return { type: 'master', role: 'admin' };
        if (bearer) {
            const apiKey = await apiKeyFromToken(bearer);
            if (apiKey) return { type: 'apikey', role: 'integration', apiKey };
        }
    }
    if (cookie) {
        const user = await userFromSession(cookie);
        if (user) return { type: 'user', role: user.role, user };
    }
    if (!(await authRequired())) return { type: 'open', role: 'admin' };
    return null;
}

function credentialsFromRequest(req) {
    const header = req.get('Authorization') || '';
    return {
        bearer: header.startsWith('Bearer ') ? header.slice(7).trim() : null,
        cookie: parseCookies(req.headers.cookie)[COOKIE] || null,
        queryToken: typeof req.query.token === 'string' ? req.query.token : null
    };
}

// ---------- middlewares ----------

let warnedQueryToken = false;

/** Identifica quem chama (req.principal) sem bloquear: quem bloqueia é requireAuth/rotas. */
function authenticate(req, res, next) {
    const credentials = credentialsFromRequest(req);
    resolvePrincipal(credentials)
        .then(principal => {
            if (principal && principal.type === 'master' && !credentials.bearer && !warnedQueryToken) {
                warnedQueryToken = true;
                log.warn('token via ?token= está obsoleto (fica em logs e histórico); use Authorization: Bearer');
            }
            req.principal = principal;
            next();
        })
        .catch(next);
}

/** Para as rotas antigas: só admin e integrações (chave de API / token mestre). */
function requireLegacyAccess(errorBody) {
    return (req, res, next) => {
        if (!req.principal) return res.status(401).json(errorBody(req, 'UNAUTHORIZED', 'token ausente ou inválido'));
        if (!['admin', 'integration'].includes(req.principal.role)) {
            return res.status(403).json(errorBody(req, 'FORBIDDEN', 'sem permissão'));
        }
        next();
    };
}

function publicUser(user) {
    if (!user) return null;
    const { passwordHash, tokenVersion, ...rest } = user;
    return rest;
}

module.exports = {
    COOKIE,
    hashPassword,
    verifyPassword,
    verifyPasswordOrDummy,
    signSession,
    sessionCookie,
    parseCookies,
    generateApiKey,
    resolvePrincipal,
    authRequired,
    refreshAuthState,
    authenticate,
    requireLegacyAccess,
    publicUser
};

/** Cria o admin de ADMIN_EMAIL/ADMIN_PASSWORD se ainda não houver usuários. */
async function seedAdmin() {
    if (!config.adminEmail || !config.adminPassword) {
        if (!(await authRequired())) {
            log.warn('API sem autenticação: defina API_TOKEN ou crie o primeiro usuário em POST /api/v1/auth/setup');
        }
        return null;
    }
    if ((await db().user.count()) > 0) return null;
    const user = await db().user.create({
        data: {
            email: config.adminEmail.toLowerCase(),
            name: 'Administrador',
            role: 'admin',
            passwordHash: await hashPassword(config.adminPassword)
        }
    });
    refreshAuthState();
    log.info({ email: user.email }, 'administrador inicial criado');
    return user;
}

module.exports.seedAdmin = seedAdmin;
