'use strict';

const express = require('express');
const { z } = require('zod');
const { asyncHandler } = require('../../http');
const { AppError } = require('../../errors');

function issues(error) {
    return error.issues.map(issue => ({ field: issue.path.join('.'), message: issue.message }));
}

/**
 * Router da API v1: cada rota declara params/query/body em zod, que servem para validar
 * e para gerar o OpenAPI. O handler recebe { params, query, body } validados e retorna:
 * - um objeto/array: vira { data } (ou { data, meta } se vier { data, meta })
 * - undefined: o handler já respondeu (ex.: arquivo)
 */
function createRouter() {
    const router = express.Router();
    const routes = [];

    function define(spec, handler) {
        routes.push(spec);
        router[spec.method](
            spec.path,
            asyncHandler(async (req, res) => {
                const input = {};
                for (const part of ['params', 'query', 'body']) {
                    if (!spec[part]) continue;
                    const parsed = spec[part].safeParse(req[part] || {});
                    if (!parsed.success) {
                        throw new AppError(400, 'INVALID_PARAMS', 'parâmetros inválidos', {
                            details: issues(parsed.error)
                        });
                    }
                    input[part] = parsed.data;
                }
                const result = await handler(input, req, res);
                if (result === undefined || res.headersSent) return;
                const body = result && result.data !== undefined && result.meta ? result : { data: result };
                res.status(spec.status || 200).json(body);
            })
        );
    }

    // chamado depois de todas as rotas
    function finish() {
        router.use((req, res) => {
            res.status(404).json({ error: { code: 'ROUTE_NOT_FOUND', message: 'rota não encontrada' } });
        });
        router.use(errorHandler);
        return router;
    }

    return { router, routes, define, finish };
}

// erros da v1: { error: { code, message, details } }
function errorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);
    if (error instanceof AppError) {
        return res.status(error.status).json({
            error: { code: error.code, message: error.message, details: error.details }
        });
    }
    next(error); // JSON inválido, payload grande e 500: http.errorHandler
}

// paginação comum
const pagination = {
    limit: z.coerce.number().int().min(1).max(100).default(50),
    offset: z.coerce.number().int().min(0).default(0)
};

module.exports = { createRouter, errorHandler, pagination };
