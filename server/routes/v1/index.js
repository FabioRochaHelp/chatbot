'use strict';

const { createRouter } = require('./router');
const authRoutes = require('./auth');
const sessionRoutes = require('./sessions');
const conversationRoutes = require('./conversations');
const statsRoutes = require('./stats');
const quickReplyRoutes = require('./quick-replies');
const flowRoutes = require('./flows');
const aiRoutes = require('./ai');
const webhookRoutes = require('./webhooks');

/** Router de /api/v1 e as rotas declaradas (para o OpenAPI). */
module.exports = function v1Routes(deps) {
    const api = createRouter();
    authRoutes(api, deps);
    sessionRoutes(api, deps);
    conversationRoutes(api, deps);
    statsRoutes(api, deps);
    quickReplyRoutes(api, deps);
    flowRoutes(api, deps);
    aiRoutes(api, deps);
    webhookRoutes(api, deps);
    return { router: api.finish(), routes: api.routes };
};
