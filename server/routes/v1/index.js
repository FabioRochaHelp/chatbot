'use strict';

const { createRouter } = require('./router');
const sessionRoutes = require('./sessions');
const conversationRoutes = require('./conversations');

/** Router de /api/v1 e as rotas declaradas (para o OpenAPI). */
module.exports = function v1Routes(deps) {
    const api = createRouter();
    sessionRoutes(api, deps);
    conversationRoutes(api, deps);
    return { router: api.finish(), routes: api.routes };
};
