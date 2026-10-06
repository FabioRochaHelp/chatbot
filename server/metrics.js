'use strict';

const client = require('prom-client');
const { db } = require('./db');
const events = require('./events');

/**
 * Métricas Prometheus em GET /metrics (exige chave de API, API_TOKEN ou login de admin).
 * Contadores são alimentados pelo barramento de eventos; gauges consultam o estado na hora da coleta.
 */
const registry = new client.Registry();
registry.setDefaultLabels({ app: 'conectzap' });
client.collectDefaultMetrics({ register: registry, prefix: 'conectzap_' });

let Sessions = null;

const messages = new client.Counter({
    name: 'conectzap_messages_total',
    help: 'Mensagens gravadas no histórico',
    labelNames: ['direction', 'origin'],
    registers: [registry]
});
const handoffs = new client.Counter({
    name: 'conectzap_handoffs_total',
    help: 'Conversas transferidas do bot para a fila',
    labelNames: ['reason'],
    registers: [registry]
});
const webhookDeliveries = new client.Counter({
    name: 'conectzap_webhook_deliveries_total',
    help: 'Tentativas de entrega de webhook',
    labelNames: ['result'],
    registers: [registry]
});
const aiReplies = new client.Counter({
    name: 'conectzap_ai_replies_total',
    help: 'Chamadas à IA por resultado',
    labelNames: ['model', 'outcome'],
    registers: [registry]
});
const aiTokens = new client.Counter({
    name: 'conectzap_ai_tokens_total',
    help: 'Tokens da IA por tipo',
    labelNames: ['model', 'type'],
    registers: [registry]
});
const aiDuration = new client.Histogram({
    name: 'conectzap_ai_request_duration_seconds',
    help: 'Tempo de resposta da IA',
    labelNames: ['model'],
    buckets: [0.5, 1, 2, 4, 8, 15, 30, 60],
    registers: [registry]
});
const httpRequests = new client.Histogram({
    name: 'conectzap_http_request_duration_seconds',
    help: 'Requisições HTTP por rota',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.01, 0.05, 0.1, 0.3, 1, 3, 10],
    registers: [registry]
});

new client.Gauge({
    name: 'conectzap_sessions',
    help: 'Sessões do WhatsApp por estado',
    labelNames: ['state'],
    registers: [registry],
    collect() {
        this.reset();
        for (const session of Sessions ? Sessions.getSessions() : []) this.inc({ state: session.state });
    }
});
new client.Gauge({
    name: 'conectzap_conversations',
    help: 'Conversas abertas por status',
    labelNames: ['status'],
    registers: [registry],
    async collect() {
        this.reset();
        const rows = await db().conversation.groupBy({
            by: ['status'],
            where: { status: { not: 'closed' } },
            _count: true
        });
        for (const status of ['bot', 'pending', 'open'])
            this.set({ status }, rows.find(row => row.status === status)?._count ?? 0);
    }
});
new client.Gauge({
    name: 'conectzap_webhook_queue',
    help: 'Entregas de webhook aguardando envio',
    registers: [registry],
    async collect() {
        this.set(await db().webhookDelivery.count({ where: { status: 'pending' } }));
    }
});

/** Uso da IA (chamado pelo pipeline e pelo playground). */
function recordAi(model, outcome, usage, seconds) {
    aiReplies.inc({ model, outcome });
    if (usage) {
        aiTokens.inc({ model, type: 'input' }, usage.inputTokens || 0);
        aiTokens.inc({ model, type: 'output' }, usage.outputTokens || 0);
        aiTokens.inc({ model, type: 'cache_read' }, usage.cacheReadTokens || 0);
        aiTokens.inc({ model, type: 'cache_write' }, usage.cacheWriteTokens || 0);
    }
    if (seconds !== undefined) aiDuration.observe({ model }, seconds);
}

/** Middleware: duração por rota (rota do Express, não a URL, para não explodir a cardinalidade). */
function httpMiddleware(req, res, next) {
    const end = httpRequests.startTimer({ method: req.method });
    res.on('finish', () => {
        const route = req.route
            ? (req.baseUrl || '') + req.route.path
            : req.path.startsWith('/assets/')
              ? '/assets'
              : 'other';
        end({ route: typeof route === 'string' ? route : 'other', status: String(res.statusCode) });
    });
    next();
}

function start(deps = {}) {
    Sessions = deps.Sessions || Sessions;
    if (start.started) return;
    start.started = true;
    events.on('message.saved', ({ message }) => messages.inc({ direction: message.direction, origin: message.origin }));
    events.on('conversation.handoff', ({ reason }) => handoffs.inc({ reason: reason || 'unknown' }));
    events.on('webhook.delivered', ({ ok }) => webhookDeliveries.inc({ result: ok ? 'success' : 'error' }));
}

module.exports = { registry, start, recordAi, httpMiddleware };
