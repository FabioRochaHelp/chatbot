import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import crypto from 'crypto';
import request from 'supertest';
import {
    resetAll,
    createApp,
    Sessions,
    history,
    db,
    disconnect,
    connect,
    incoming,
    server,
    events
} from './helpers.js';

const webhooks = server('../server/webhooks.js');
const pipeline = server('../server/pipeline/index.js');

afterAll(() => disconnect());

/** fetch falso que guarda as chamadas e responde com o status dado. */
function fakeFetch(...statuses) {
    return vi.fn(async () => {
        const status = statuses.length > 1 ? statuses.shift() : statuses[0];
        if (status instanceof Error) throw status;
        return { ok: status >= 200 && status < 300, status };
    });
}

async function hook(data = {}) {
    return db().webhook.create({
        data: {
            url: 'https://hooks.exemplo.com/conectzap',
            secret: 'whsec_teste',
            events: ['message.received'],
            ...data
        }
    });
}

beforeEach(async () => {
    await resetAll();
    await db().webhookDelivery.deleteMany();
    await db().webhook.deleteMany();
    webhooks._sessionIds.clear();
});

describe('entrega', () => {
    it('assina corpo + timestamp (verificável do lado de quem recebe)', async () => {
        const target = await hook();
        await webhooks.enqueue('message.received', null, { hello: 'mundo' });
        const fetch = fakeFetch(200);
        webhooks.worker.fetch = fetch;
        await webhooks.worker.tick();

        const [url, init] = fetch.mock.calls[0];
        expect(url).toBe(target.url);
        expect(init.headers['X-ConectZap-Event']).toBe('message.received');
        const expected =
            'sha256=' +
            crypto
                .createHmac('sha256', 'whsec_teste')
                .update(`${init.headers['X-ConectZap-Timestamp']}.${init.body}`)
                .digest('hex');
        expect(init.headers['X-ConectZap-Signature']).toBe(expected);
        const body = JSON.parse(init.body);
        expect(body).toMatchObject({ event: 'message.received', data: { hello: 'mundo', session: null } });

        const delivery = await db().webhookDelivery.findFirst();
        expect(delivery).toMatchObject({ status: 'success', attempts: 1, lastStatus: 200 });
    });

    it('falha agenda nova tentativa com espera crescente e desiste após o limite', async () => {
        await hook();
        await webhooks.enqueue('message.received', null, {});
        webhooks.worker.fetch = fakeFetch(500);
        await webhooks.worker.tick();
        let delivery = await db().webhookDelivery.findFirst();
        expect(delivery).toMatchObject({ status: 'pending', attempts: 1, lastStatus: 500, lastError: 'HTTP 500' });
        const wait = delivery.nextAttemptAt.getTime() - Date.now();
        expect(wait).toBeGreaterThan(8000);
        expect(wait).toBeLessThanOrEqual(10000);

        // ainda não venceu: não reenvia
        await webhooks.worker.tick();
        expect(webhooks.worker.fetch).toHaveBeenCalledTimes(1);

        await db().webhookDelivery.updateMany({
            data: { attempts: webhooks.MAX_ATTEMPTS - 1, nextAttemptAt: new Date() }
        });
        webhooks.worker.fetch = fakeFetch(new TypeError('fetch failed'));
        await webhooks.worker.tick();
        delivery = await db().webhookDelivery.findFirst();
        expect(delivery).toMatchObject({ status: 'failed', attempts: webhooks.MAX_ATTEMPTS });
    });

    it('filtra por evento, sessão e ignora webhooks antigos e inativos', async () => {
        const s1 = await db().session.create({ data: { name: 's1', engine: 'WPPCONNECT' } });
        const s2 = await db().session.create({ data: { name: 's2', engine: 'WPPCONNECT' } });
        await hook({ url: 'https://a.exemplo/todas' });
        await hook({ url: 'https://a.exemplo/s1', sessionId: s1.id });
        await hook({ url: 'https://a.exemplo/s2', sessionId: s2.id });
        await hook({ url: 'https://a.exemplo/outro-evento', events: ['session.state'] });
        await hook({ url: 'https://a.exemplo/inativo', active: false });
        await hook({ url: 'https://a.exemplo/legado', legacy: true, sessionId: s1.id });

        expect(await webhooks.enqueue('message.received', 's1', {})).toBe(2);
        const urls = (await db().webhookDelivery.findMany({ include: { webhook: true } }))
            .map(item => item.webhook.url)
            .sort();
        expect(urls).toEqual(['https://a.exemplo/s1', 'https://a.exemplo/todas']);
    });

    it('mensagem recebida/enviada viram eventos; nota interna não', async () => {
        await hook({ events: ['message.received', 'message.sent'] });
        const received = await history.recordIncoming('s1', incoming({ body: 'oi' }));
        const conversation = await db().conversation.findUnique({
            where: { id: received.conversationId },
            include: { contact: true }
        });
        await webhooks.listeners['message.saved']({
            session: 's1',
            message: received,
            conversation,
            contact: conversation.contact
        });
        await webhooks.listeners['message.saved']({
            session: 's1',
            message: { ...received, direction: 'out' },
            conversation,
            contact: conversation.contact
        });
        await webhooks.listeners['message.saved']({
            session: 's1',
            message: { ...received, direction: 'note' },
            conversation,
            contact: conversation.contact
        });
        const deliveries = await db().webhookDelivery.findMany({ orderBy: { id: 'asc' } });
        expect(deliveries.map(item => item.event)).toEqual(['message.received', 'message.sent']);
        expect(deliveries[0].payload).toMatchObject({
            session: 's1',
            message: { body: 'oi' },
            contact: { waId: '556334140378@c.us', pushName: 'Maria' },
            conversation: { status: 'pending' }
        });
    });

    it('transferência do bot chega com o status já atualizado', async () => {
        await hook({ events: ['conversation.handoff'] });
        const definition = {
            nodes: [
                { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
                { id: 'h', type: 'handoff', position: { x: 0, y: 0 }, data: { text: 'Transferindo' } }
            ],
            edges: [{ id: '1', source: 's', target: 'h' }],
            settings: {}
        };
        const flow = await db().flow.create({ data: { name: 'F', definition, published: definition, version: 1 } });
        await db().session.create({ data: { name: 's1', engine: 'WPPCONNECT', botMode: 'flow', flowId: flow.id } });
        connect('s1');
        const listener = payload => webhooks.listeners['conversation.handoff'](payload);
        let pending;
        events.on('conversation.handoff', payload => (pending = listener(payload)));
        const saved = await history.recordIncoming('s1', incoming());
        await pipeline.handle(Sessions, 's1', saved);
        await pending;
        events.removeAllListeners('conversation.handoff');
        const delivery = await db().webhookDelivery.findFirst({ where: { event: 'conversation.handoff' } });
        expect(delivery.payload).toMatchObject({ reason: 'flow', conversation: { status: 'pending' } });
    });
});

describe('API de webhooks e métricas', () => {
    const app = createApp({ sessions: Sessions });
    vi.spyOn(Sessions, 'launch').mockImplementation(() => undefined);
    let admin;
    beforeEach(async () => {
        admin = request.agent(app);
        await admin.post('/api/v1/auth/setup').send({ email: 'a@x.com', name: 'Admin', password: 'senha-forte-1' });
    });

    it('cria (com segredo), lista sem segredo, gira o segredo, testa e reenvia', async () => {
        await admin.post('/api/v1/sessions').send({ name: 's1' });
        const created = await admin.post('/api/v1/webhooks').send({
            url: 'https://crm.exemplo.com/hook',
            session: 's1',
            events: ['message.received', 'conversation.handoff']
        });
        expect(created.status).toBe(201);
        expect(created.body.data).toMatchObject({ session: 's1', hasSecret: true, active: true });
        expect(created.body.data.secret).toMatch(/^whsec_/);
        const id = created.body.data.id;

        const list = await admin.get('/api/v1/webhooks');
        expect(list.body.data[0]).not.toHaveProperty('secret');
        const rotated = await admin.patch('/api/v1/webhooks/' + id).send({ rotateSecret: true });
        expect(rotated.body.data.secret).not.toBe(created.body.data.secret);

        expect(
            (await admin.post('/api/v1/webhooks').send({ url: 'ftp://x', events: ['message.received'] })).status
        ).toBe(400);
        expect((await admin.post('/api/v1/webhooks').send({ url: 'https://x.com', events: ['nada'] })).status).toBe(
            400
        );

        const ping = await admin.post(`/api/v1/webhooks/${id}/test`);
        expect(ping.body.data).toMatchObject({ event: 'ping', status: 'pending' });
        await db().webhookDelivery.update({
            where: { id: ping.body.data.id },
            data: { status: 'failed', attempts: 7 }
        });
        const retried = await admin.post(`/api/v1/webhook-deliveries/${ping.body.data.id}/retry`);
        expect(retried.body.data).toMatchObject({ status: 'pending', attempts: 0 });
        const deliveries = await admin.get(`/api/v1/webhooks/${id}/deliveries`);
        expect(deliveries.body.data).toHaveLength(1);
        expect((await admin.get('/api/v1/webhooks/events')).body.data).toContain('session.state');
    });

    it('webhook antigo (/sendHook) aparece na lista e só muda URL/ativo', async () => {
        await admin.post('/api/v1/sessions').send({ name: 's1' });
        const key = (await admin.post('/api/v1/api-keys').send({ name: 'legado' })).body.data.key;
        await request(app)
            .post('/sendHook')
            .set('Authorization', 'Bearer ' + key)
            .send({ sessionName: 's1', hook: 'https://antigo.exemplo/hook' });
        const [legacy] = (await admin.get('/api/v1/webhooks')).body.data;
        expect(legacy).toMatchObject({ legacy: true, url: 'https://antigo.exemplo/hook', hasSecret: false });
        expect(
            (await admin.patch('/api/v1/webhooks/' + legacy.id).send({ events: ['session.state'] })).body.error.code
        ).toBe('LEGACY_WEBHOOK');
        expect((await admin.patch('/api/v1/webhooks/' + legacy.id).send({ active: false })).body.data.active).toBe(
            false
        );
    });

    it('/metrics exige credencial e expõe as métricas', async () => {
        expect((await request(app).get('/metrics')).status).toBe(401);
        const res = await admin.get('/metrics');
        expect(res.status).toBe(200);
        expect(res.headers['content-type']).toMatch(/text\/plain/);
        expect(res.text).toContain('conectzap_sessions');
        expect(res.text).toContain('conectzap_conversations{status="pending"');
        expect(res.text).toContain('conectzap_webhook_queue');
        expect(res.text).toContain('conectzap_http_request_duration_seconds_bucket');
    });
});
