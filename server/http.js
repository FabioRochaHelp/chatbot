'use strict';

const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const log = require('./logger');

// /api/* usa o formato da v1 ({ error: { code, message } }); o resto, o formato antigo
function errorBody(req, code, message) {
    if (req.originalUrl.startsWith('/api/')) return { error: { code, message: message || code } };
    return { result: 'error', message: code };
}

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

function security(config) {
    const middlewares = [
        // cross-origin: o PNG de /qrcode?image=true costuma ser usado em <img> de outros sites
        helmet({
            crossOriginResourcePolicy: { policy: 'cross-origin' },
            // sem HTTPS próprio, upgrade-insecure-requests quebra o acesso por http://<ip>:3333
            contentSecurityPolicy: { directives: { upgradeInsecureRequests: config.https ? [] : null } }
        }),
        cors(config.corsOrigins.length ? { origin: config.corsOrigins } : undefined)
    ];
    if (config.rateLimit > 0) {
        middlewares.push(
            rateLimit({
                windowMs: 60 * 1000,
                limit: config.rateLimit,
                standardHeaders: 'draft-8',
                legacyHeaders: false,
                handler: (req, res, next, options) =>
                    res.status(options.statusCode).json(errorBody(req, 'TOO_MANY_REQUESTS', 'muitas requisições'))
            })
        );
    }
    return middlewares;
}

function notFound(req, res) {
    res.status(404).json(errorBody(req, 'ROUTE_NOT_FOUND', 'rota não encontrada'));
}

// Express reconhece o error handler pelos 4 parâmetros
function errorHandler(error, req, res, next) {
    if (error.type === 'entity.parse.failed') {
        return res.status(400).json(errorBody(req, 'INVALID_JSON', 'JSON inválido'));
    }
    if (error.type === 'entity.too.large') {
        return res.status(413).json(errorBody(req, 'PAYLOAD_TOO_LARGE', 'payload muito grande'));
    }
    // erros HTTP do Express/middlewares (ex.: 404 do express.static)
    const status = error.status || error.statusCode;
    if (status >= 400 && status < 500) {
        const code = status === 404 ? 'NOT_FOUND' : 'HTTP_' + status;
        return res.status(status).json(errorBody(req, code, error.expose ? error.message : code));
    }
    log.error({ err: error, method: req.method, url: req.path }, 'erro não tratado');
    if (req.originalUrl.startsWith('/api/')) {
        return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'erro interno' } });
    }
    res.status(500).json({ result: 'error', message: error.message || 'INTERNAL_ERROR' });
}

module.exports = { asyncHandler, validated, errorBody, security, notFound, errorHandler };
