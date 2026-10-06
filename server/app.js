'use strict';

const express = require('express');
const http = require('./http');
const legacyRoutes = require('./routes/legacy');

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

    app.use(http.auth(config.apiToken));
    app.use(legacyRoutes(Sessions));

    app.use(http.notFound);
    app.use(http.errorHandler);
    return app;
}

module.exports = { createApp };
