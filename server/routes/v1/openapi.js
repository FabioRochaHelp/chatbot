'use strict';

const { z } = require('zod');

const jsonSchema = schema => {
    const json = z.toJSONSchema(schema, { io: 'input', unrepresentable: 'any' });
    delete json.$schema;
    return json;
};

function parameters(schema, location) {
    if (!schema) return [];
    const json = jsonSchema(schema);
    const required = new Set(json.required || []);
    return Object.entries(json.properties || {}).map(([name, property]) => {
        const { description, ...rest } = property;
        return {
            name,
            in: location,
            required: location === 'path' || required.has(name),
            ...(description ? { description } : {}),
            schema: rest
        };
    });
}

const errorResponse = description => ({
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } }
});

/** Monta o documento OpenAPI 3.1 a partir das rotas declaradas no router v1. */
function buildOpenApi(routes, { version, basePath }) {
    const paths = {};
    for (const route of routes) {
        const path = basePath + route.path.replace(/:(\w+)/g, '{$1}');
        const operation = {
            tags: route.tags,
            summary: route.summary,
            ...(route.description ? { description: route.description } : {}),
            parameters: [...parameters(route.params, 'path'), ...parameters(route.query, 'query')],
            responses: {
                [route.status || 200]: { description: 'OK' },
                400: errorResponse('Parâmetros inválidos'),
                401: errorResponse('Não autenticado')
            }
        };
        if (route.body) {
            operation.requestBody = {
                required: true,
                content: { 'application/json': { schema: jsonSchema(route.body) } }
            };
        }
        if (route.params) operation.responses[404] = errorResponse('Não encontrado');
        paths[path] = { ...(paths[path] || {}), [route.method]: operation };
    }
    return {
        openapi: '3.1.0',
        info: {
            title: 'MyZap API',
            version,
            description:
                'API v1 do MyZap. Respostas de sucesso vêm em `{ data }` (listas paginadas em `{ data, meta }`); ' +
                'erros em `{ error: { code, message, details } }`. As rotas antigas (/sendText, /start...) continuam ' +
                'disponíveis com o formato `{ result, message }`.'
        },
        servers: [{ url: '/' }],
        security: [{ bearer: [] }],
        components: {
            securitySchemes: { bearer: { type: 'http', scheme: 'bearer', description: 'API_TOKEN' } },
            schemas: {
                Error: {
                    type: 'object',
                    properties: {
                        error: {
                            type: 'object',
                            properties: { code: { type: 'string' }, message: { type: 'string' }, details: {} },
                            required: ['code', 'message']
                        }
                    }
                }
            }
        },
        paths
    };
}

module.exports = { buildOpenApi };
