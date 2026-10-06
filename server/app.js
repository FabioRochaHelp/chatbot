'use strict';

const express = require('express');
const http = require('./http');
const swaggerUi = require('swagger-ui-express');
const legacyRoutes = require('./routes/legacy');
const v1Routes = require('./routes/v1');
const { buildOpenApi } = require('./routes/v1/openapi');
const { version } = require('../package.json');

/**
 * Monta a app Express sem abrir porta (o listen fica no index.js).
 * deps.sessions / deps.config permitem injetar dublês nos testes.
 */
function createApp(deps = {}) {
    const config = deps.config || require('./config');
    const Sessions = deps.sessions || require('./sessions');

    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', config.trustProxy);
    app.use(http.security(config));
    app.use(express.json({ limit: '20mb' }));

    app.get('/', (req, res) => res.json({ result: 'ok' }));

    const v1 = v1Routes({ Sessions });
    const openapi = buildOpenApi(v1.routes, { version, basePath: '/api/v1' });
    // documentação pública (só descreve as rotas; chamar a API continua exigindo o token)
    app.get('/api/openapi.json', (req, res) => res.json(openapi));
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'MyZap API' }));

    app.use(http.auth(config.apiToken));
    app.use('/api/v1', v1.router);
    app.use(legacyRoutes(Sessions));

    app.use(http.notFound);
    app.use(http.errorHandler);
    return app;
}

module.exports = { createApp };
