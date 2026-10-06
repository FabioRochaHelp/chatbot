import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import {
    resetAll,
    connect,
    fakeClient,
    incoming,
    createApp,
    Sessions,
    history,
    db,
    disconnect,
    useApiToken
} from './helpers.js';

const app = createApp({ sessions: Sessions });
const api = {
    get: url =>
        request(app)
            .get('/api/v1' + url)
            .set('Authorization', 'Bearer segredo'),
    post: (url, body) =>
        request(app)
            .post('/api/v1' + url)
            .set('Authorization', 'Bearer segredo')
            .send(body),
    patch: (url, body) =>
        request(app)
            .patch('/api/v1' + url)
            .set('Authorization', 'Bearer segredo')
            .send(body)
};
const launch = vi.spyOn(Sessions, 'launch').mockImplementation(() => undefined);

useApiToken({ beforeAll, afterAll }, 'segredo');
afterAll(() => disconnect());
beforeEach(async () => {
    await resetAll();
    launch.mockClear();
});

describe('API v1: geral', () => {
    it('exige token', async () => {
        const res = await request(app).get('/api/v1/sessions');
        expect(res.status).toBe(401);
    });

    it('OpenAPI e Swagger são públicos', async () => {
        const spec = await request(app).get('/api/openapi.json');
        expect(spec.status).toBe(200);
        expect(spec.body.openapi).toBe('3.1.0');
        expect(spec.body.paths['/api/v1/sessions/{name}/messages'].post).toBeDefined();
        const docs = await request(app).get('/api/docs/');
        expect(docs.status).toBe(200);
        expect(docs.headers['content-security-policy']).not.toContain('upgrade-insecure-requests');
    });

    it('erros no formato { error }', async () => {
        const notFound = await api.get('/nada');
        expect(notFound.status).toBe(404);
        expect(notFound.body.error.code).toBe('ROUTE_NOT_FOUND');

        const invalid = await api.post('/sessions', { name: '../x' });
        expect(invalid.status).toBe(400);
        expect(invalid.body.error).toMatchObject({ code: 'INVALID_PARAMS', details: [{ field: 'name' }] });

        const badJson = await request(app)
            .post('/api/v1/sessions')
            .set('Authorization', 'Bearer segredo')
            .set('Content-Type', 'application/json')
            .send('{x');
        expect(badJson.body.error.code).toBe('INVALID_JSON');
    });
});

describe('API v1: sessões', () => {
    it('cria, lista, altera e fecha', async () => {
        const created = await api.post('/sessions', { name: 'loja', botMode: 'flow' });
        expect(created.status).toBe(201);
        expect(created.body.data).toMatchObject({ name: 'loja', state: 'STARTING', autoStart: true, botMode: 'flow' });
        expect(launch).toHaveBeenCalledTimes(1);

        const list = await api.get('/sessions');
        expect(list.body.data.map(session => session.name)).toEqual(['loja']);

        const patched = await api.patch('/sessions/loja', { botMode: 'ai' });
        expect(patched.body.data.botMode).toBe('ai');

        const closed = await api.post('/sessions/loja/close');
        expect(closed.body.data).toMatchObject({ state: 'CLOSED', autoStart: false });

        expect((await api.get('/sessions/outra')).status).toBe(404);
    });

    it('QR code: 409 sem QR, JSON e PNG com QR', async () => {
        await api.post('/sessions', { name: 'qr' });
        expect((await api.get('/sessions/qr/qrcode')).status).toBe(409);

        const session = Sessions.getSession('qr');
        session.state = 'QRCODE';
        session.qrcode = 'data:image/png;base64,' + Buffer.from('png').toString('base64');
        expect((await api.get('/sessions/qr/qrcode')).body.data.state).toBe('QRCODE');
        const png = await api.get('/sessions/qr/qrcode?format=png');
        expect(png.headers['content-type']).toBe('image/png');
        expect(png.body.toString()).toBe('png');
    });
});

describe('API v1: mensagens', () => {
    it('envia texto e grava no histórico', async () => {
        const client = connect('s1');
        const res = await api.post('/sessions/s1/messages', { to: '+55 63 3414-0378', type: 'text', text: 'Olá' });
        expect(res.status).toBe(201);
        expect(res.body.data).toMatchObject({ direction: 'out', origin: 'api', type: 'chat', body: 'Olá' });
        expect(client.sendText).toHaveBeenCalledWith('556334140378@c.us', 'Olá');
    });

    it('envia arquivo (data URL) e guarda a mídia', async () => {
        const client = connect('s1');
        const base64 = 'data:text/plain;base64,' + Buffer.from('conteúdo').toString('base64');
        const res = await api.post('/sessions/s1/messages', {
            to: '556334140378',
            type: 'file',
            base64,
            fileName: 'nota.txt',
            caption: 'segue'
        });
        expect(res.status).toBe(201);
        expect(client.sendFile.mock.calls[0][2]).toBe('nota.txt');
        const media = await api.get('/messages/' + res.body.data.id + '/media');
        expect(media.status).toBe(200);
        expect(media.text || media.body.toString()).toBe('conteúdo');
    });

    it('valida o tipo e o conteúdo', async () => {
        connect('s1');
        const bad = await api.post('/sessions/s1/messages', { to: '556334140378', type: 'text' });
        expect(bad.status).toBe(400);
        const badType = await api.post('/sessions/s1/messages', { to: '556334140378', type: 'sticker' });
        expect(badType.status).toBe(400);
        const badLocation = await api.post('/sessions/s1/messages', {
            to: '556334140378',
            type: 'location',
            lat: 200,
            lng: 0
        });
        expect(badLocation.status).toBe(400);
    });

    it('404 sem sessão, 409 desconectada, 502 se o WhatsApp falhar', async () => {
        const body = { to: '556334140378', type: 'text', text: 'oi' };
        expect((await api.post('/sessions/s1/messages', body)).status).toBe(404);

        Sessions.sessions.push({ name: 's2', state: 'QRCODE' });
        const disconnected = await api.post('/sessions/s2/messages', body);
        expect(disconnected.status).toBe(409);
        expect(disconnected.body.error.details).toEqual({ state: 'QRCODE' });

        connect('s3', fakeClient({ sendText: vi.fn().mockRejectedValue(new Error('número bloqueado')) }));
        const failed = await api.post('/sessions/s3/messages', body);
        expect(failed.status).toBe(502);
        expect(failed.body.error).toMatchObject({ code: 'SEND_FAILED', message: 'número bloqueado' });
    });

    it('localização vai como string para o wppconnect', async () => {
        const client = connect('s1');
        const res = await api.post('/sessions/s1/messages', {
            to: '556334140378',
            type: 'location',
            lat: -10.18,
            lng: -48.33,
            name: 'Palmas'
        });
        expect(res.body.data).toMatchObject({
            type: 'location',
            payload: { lat: -10.18, lng: -48.33, name: 'Palmas' }
        });
        expect(client.sendLocation).toHaveBeenCalledWith('556334140378@c.us', '-10.18', '-48.33', 'Palmas');
    });

    it('verifica número', async () => {
        connect('s1');
        const res = await api.get('/sessions/s1/numbers/556334140378');
        expect(res.body.data).toEqual({ id: '556334140378@c.us', numberExists: true });
    });
});

describe('API v1: conversas e contatos', () => {
    async function seed() {
        const client = connect('s1');
        await history.recordIncoming('s1', incoming({ body: 'primeira' }));
        await history.recordIncoming('s1', incoming({ body: 'segunda' }));
        await history.recordIncoming('s1', incoming({ from: '5511922222222@c.us', sender: { pushname: 'João' } }));
        return client;
    }

    it('lista com filtros, busca e última mensagem', async () => {
        await seed();
        const all = await api.get('/conversations');
        expect(all.body.meta.total).toBe(2);
        expect(all.body.data[0]).toHaveProperty('lastMessage');
        expect(all.body.data[0].session).toBe('s1');

        const maria = await api.get('/conversations?q=Maria');
        expect(maria.body.data).toHaveLength(1);
        expect(maria.body.data[0].lastMessage.body).toBe('segunda');
        expect(maria.body.data[0].unreadCount).toBe(2);

        expect((await api.get('/conversations?status=closed')).body.data).toHaveLength(0);
        expect((await api.get('/conversations?status=errado')).status).toBe(400);
    });

    it('mensagens paginadas em ordem cronológica', async () => {
        await seed();
        const [conversation] = (await api.get('/conversations?q=Maria')).body.data;
        const page = await api.get('/conversations/' + conversation.id + '/messages?limit=1');
        expect(page.body.data.map(message => message.body)).toEqual(['segunda']);
        expect(page.body.meta.hasMore).toBe(true);
        const older = await api.get('/conversations/' + conversation.id + '/messages?before=' + page.body.data[0].id);
        expect(older.body.data.map(message => message.body)).toEqual(['primeira']);
        expect(older.body.meta.hasMore).toBe(false);
    });

    it('responde na conversa, marca como lida e encerra', async () => {
        const client = await seed();
        const [conversation] = (await api.get('/conversations?q=Maria')).body.data;

        const reply = await api.post('/conversations/' + conversation.id + '/messages', {
            type: 'text',
            text: 'Oi Maria'
        });
        expect(reply.status).toBe(201);
        expect(client.sendText).toHaveBeenCalledWith('556334140378@c.us', 'Oi Maria');
        expect(reply.body.data.conversationId).toBe(conversation.id);

        const read = await api.patch('/conversations/' + conversation.id, { read: true, status: 'closed' });
        expect(read.body.data).toMatchObject({ unreadCount: 0, status: 'closed' });
        expect(read.body.data.closedAt).not.toBeNull();
        expect((await api.get('/conversations/999')).status).toBe(404);
    });

    it('contatos: lista, busca e edita nome/tags', async () => {
        await seed();
        const list = await api.get('/contacts?q=5511922');
        expect(list.body.data).toHaveLength(1);
        const id = list.body.data[0].id;
        const patched = await api.patch('/contacts/' + id, { name: 'João Silva', tags: ['vip'] });
        expect(patched.body.data).toMatchObject({ name: 'João Silva', tags: ['vip'], pushName: 'João' });
        expect((await api.patch('/contacts/' + id, { tags: [''] })).status).toBe(400);
    });

    it('rotas antigas também gravam o histórico', async () => {
        connect('s1');
        const res = await request(app)
            .post('/sendText')
            .set('Authorization', 'Bearer segredo')
            .send({ sessionName: 's1', number: '556334140378', text: 'legado' });
        expect(res.body).toEqual({ result: 'success' });
        expect(await db().message.findFirst({ where: { body: 'legado' } })).toMatchObject({ origin: 'api' });
    });
});
