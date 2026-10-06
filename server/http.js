'use strict';

const crypto = require('crypto');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const log = require('./logger');

// Express 4 não captura rejeições de handlers async
const asyncHandler = fn => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

/**
 * Valida query + body (query tem prioridade, como o antigo param()) e chama fn(input, req, res).
 * Erro de validação: 400 { result: "error", message: "INVALID_PARAMS", errors }.
 */
function validated(schema, fn) {
    return asyncHandler(async (req, res) => {
        const parsed = schema.safeParse({ ...(req.body || {}), ...req.query });
        if (!parsed.success) {
            return res.status(400).json({
                result: 'error',
                message: 'INVALID_PARAMS',
                errors: parsed.error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message }))
            });
        }
        const result = await fn(parsed.data, req, res);
        if (result !== undefined && !res.headersSent) res.json(result);
    });
}

function safeEqual(a, b) {
    const bufA = Buffer.from(String(a));
    const bufB = Buffer.from(String(b));
    return bufA.length === bufB.length && crypto.timingSafeEqual(bufA, bufB);
}

// autenticação opcional: Authorization: Bearer <API_TOKEN> ou ?token=<API_TOKEN>
function auth(apiToken) {
    let warnedQueryToken = false;
    return (req, res, next) => {
        if (!apiToken) return next();
        const header = req.get('Authorization') || '';
        let token = header.startsWith('Bearer ') ? header.slice(7) : null;
        if (!token && req.query.token) {
            token = req.query.token;
            if (!warnedQueryToken) {
                warnedQueryToken = true;
                log.warn('token via ?token= está obsoleto (fica em logs e histórico); use Authorization: Bearer');
            }
        }
        if (token && safeEqual(token, apiToken)) return next();
        res.status(401).json({ result: 'error', message: 'UNAUTHORIZED' });
    };
}

function security(config) {
    const middlewares = [
        // cross-origin: o PNG de /qrcode?image=true costuma ser usado em <img> de outros sites
        helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }),
        cors(config.corsOrigins.length ? { origin: config.corsOrigins } : undefined)
    ];
    if (config.rateLimit > 0) {
        middlewares.push(
            rateLimit({
                windowMs: 60 * 1000,
                limit: config.rateLimit,
                standardHeaders: 'draft-8',
                legacyHeaders: false,
                message: { result: 'error', message: 'TOO_MANY_REQUESTS' }
            })
        );
    }
    return middlewares;
}

function notFound(req, res) {
    res.status(404).json({ result: 'error', message: 'ROUTE_NOT_FOUND' });
}

// Express reconhece o error handler pelos 4 parâmetros
function errorHandler(error, req, res, next) {
    if (error.type === 'entity.parse.failed') {
        return res.status(400).json({ result: 'error', message: 'INVALID_JSON' });
    }
    if (error.type === 'entity.too.large') {
        return res.status(413).json({ result: 'error', message: 'PAYLOAD_TOO_LARGE' });
    }
    log.error({ err: error, method: req.method, url: req.path }, 'erro não tratado');
    res.status(500).json({ result: 'error', message: error.message || 'INTERNAL_ERROR' });
}

module.exports = { asyncHandler, validated, auth, security, notFound, errorHandler };
