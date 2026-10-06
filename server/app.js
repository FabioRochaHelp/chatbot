'use strict';

const fs = require('fs');
const path = require('path');
const express = require('express');
const http = require('./http');
const auth = require('./auth');
const metrics = require('./metrics');
const swaggerUi = require('swagger-ui-express');
const legacyRoutes = require('./routes/legacy');
const v1Routes = require('./routes/v1');
const { buildOpenApi } = require('./routes/v1/openapi');
const { version } = require('../package.json');

/**
 * Monta a app Express sem abrir porta (o listen fica no index.js).
 * deps.sessions permite injetar um dublê nos testes.
 */
function createApp(deps = {}) {
    const config = require('./config');
    const Sessions = deps.sessions || require('./sessions');

    const app = express();
    app.disable('x-powered-by');
    app.set('trust proxy', config.trustProxy);
    app.use(metrics.httpMiddleware);
    app.use(http.security(config));
    app.use(express.json({ limit: '20mb' }));

    app.get('/health', (req, res) => res.json({ result: 'ok' }));
    const spa = webApp(deps.webDir || path.join(__dirname, '..', 'web', 'dist'));
    // GET / devolve JSON (healthcheck e clientes antigos), a não ser que o navegador peça HTML
    app.get('/', (req, res, next) =>
        spa && req.accepts(['json', 'html']) === 'html' ? next() : res.json({ result: 'ok' })
    );
    if (spa) app.use(spa);

    const v1 = v1Routes({ Sessions });
    const openapi = buildOpenApi(v1.routes, { version, basePath: '/api/v1' });
    // documentação pública (só descreve as rotas; chamar a API continua exigindo o token)
    app.get('/api/openapi.json', (req, res) => res.json(openapi));
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(openapi, { customSiteTitle: 'MyZap API' }));

    app.use(auth.authenticate);
    // Prometheus: chave de API (bearer_token no scrape), API_TOKEN ou admin
    app.get('/metrics', auth.requireLegacyAccess(http.errorBody), async (req, res) => {
        res.set('Content-Type', metrics.registry.contentType);
        res.send(await metrics.registry.metrics());
    });
    app.use('/api/v1', v1.router);
    app.use(auth.requireLegacyAccess(http.errorBody), legacyRoutes(Sessions));

    app.use(http.notFound);
    app.use(http.errorHandler);
    return app;
}

// rotas do painel (React Router); lista fixa para não colidir com as rotas antigas (/status, /qrcode...)
const SPA_ROUTES = /^\/(login|setup|sessions|send|inbox|flows|ai|webhooks|settings)?(\/.*)?$/;

/** Serve o build do painel (web/dist), se existir. */
function webApp(dir) {
    const index = path.join(dir, 'index.html');
    if (!fs.existsSync(index)) return null;
    const router = express.Router();
    router.use(
        '/assets',
        express.static(path.join(dir, 'assets'), { immutable: true, maxAge: '1y', fallthrough: false })
    );
    router.use(express.static(dir, { index: false }));
    router.get(SPA_ROUTES, (req, res, next) => {
        if (req.accepts(['json', 'html']) !== 'html') return next();
        res.setHeader('Cache-Control', 'no-cache');
        res.sendFile(index);
    });
    return router;
}

module.exports = { createApp };
