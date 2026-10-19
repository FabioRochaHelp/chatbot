import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'http';
import request from 'supertest';
import { io as connectClient } from 'socket.io-client';
import { resetAll, createApp, Sessions, events, server, disconnect } from './helpers.js';

const realtime = server('../server/realtime.js');

let httpServer;
let rt;
let url;
let adminCookie;
let agentCookie;
const sockets = [];

function connect(options = {}) {
    const socket = connectClient(url, {
        path: '/socket.io',
        transports: ['websocket'],
        reconnection: false,
        ...options
    });
    sockets.push(socket);
    return socket;
}

const once = (socket, event) => new Promise(resolve => socket.once(event, resolve));
const cookieOf = res => res.headers['set-cookie'][0].split(';')[0];

beforeAll(async () => {
    await resetAll();
    Sessions.sessions = [{ name: 'loja', state: 'QRCODE' }];
    const app = createApp({ sessions: Sessions });
    httpServer = http.createServer(app);
    rt = realtime.attach(httpServer, { Sessions });
    await new Promise(resolve => httpServer.listen(0, '127.0.0.1', resolve));
    url = 'http://127.0.0.1:' + httpServer.address().port;

    const setup = await request(app)
        .post('/api/v1/auth/setup')
        .send({ email: 'admin@exemplo.com', name: 'Admin', password: 'senha-forte-1' });
    adminCookie = cookieOf(setup);
    await request(app)
        .post('/api/v1/users')
        .set('Cookie', adminCookie)
        .send({ email: 'ana@exemplo.com', name: 'Ana', password: 'senha-ana-1', role: 'agent' });
    agentCookie = cookieOf(
        await request(app).post('/api/v1/auth/login').send({ email: 'ana@exemplo.com', password: 'senha-ana-1' })
    );
});

afterAll(async () => {
    sockets.forEach(socket => socket.close());
    await rt.close();
    await new Promise(resolve => httpServer.close(resolve));
    Sessions.sessions = [];
    await disconnect();
});

describe('realtime', () => {
    it('recusa conexão sem credencial', async () => {
        const socket = connect();
        const error = await once(socket, 'connect_error');
        expect(error.message).toBe('UNAUTHORIZED');
    });

    it('admin recebe snapshot, status, QR e mensagens', async () => {
        const socket = connect({ extraHeaders: { cookie: adminCookie } });
        expect(await once(socket, 'sessions')).toEqual([{ name: 'loja', state: 'QRCODE' }]);

        const qr = once(socket, 'session.qrcode');
        events.emit('session.qrcode', { session: 'loja', qrcode: 'data:image/png;base64,AAA' });
        expect(await qr).toEqual({ session: 'loja', qrcode: 'data:image/png;base64,AAA' });

        const saved = once(socket, 'message.saved');
        events.emit('message.saved', { session: 'loja', message: { id: 1, body: 'oi' } });
        expect((await saved).message.body).toBe('oi');
    });

    it('atendente recebe mensagens, mas não o QR code', async () => {
        const socket = connect({ extraHeaders: { cookie: agentCookie } });
        await once(socket, 'sessions');
        const received = [];
        socket.on('session.qrcode', payload => received.push(payload));
        const state = once(socket, 'session.state');
        events.emit('session.qrcode', { session: 'loja', qrcode: 'x' });
        events.emit('session.state', { session: 'loja', state: 'CONNECTED' });
        expect(await state).toEqual({ session: 'loja', state: 'CONNECTED' });
        expect(received).toEqual([]);
    });

    it('atendente só recebe eventos das conversas que pode ver', async () => {
        const socket = connect({ extraHeaders: { cookie: agentCookie } });
        await once(socket, 'sessions');
        const received = [];
        socket.on('message.saved', payload => received.push(payload.message.body));
        const visible = once(socket, 'conversation.updated');
        events.emit('message.saved', { message: { body: 'outro departamento' }, conversation: { departmentId: 999 } });
        events.emit('message.saved', { message: { body: 'sem departamento' }, conversation: { departmentId: null } });
        events.emit('conversation.updated', {
            conversation: { id: 1, departmentId: 999 },
            previous: { departmentId: null, assignedUserId: null }
        });
        // saiu da fila sem departamento: quem via antes recebe para tirar da lista
        expect((await visible).conversation.id).toBe(1);
        expect(received).toEqual(['sem departamento']);
    });

    it('user.revoked derruba as conexões do usuário', async () => {
        const socket = connect({ extraHeaders: { cookie: agentCookie } });
        await once(socket, 'sessions');
        const users = await request(httpServer).get('/api/v1/users').set('Cookie', adminCookie);
        const ana = users.body.data.find(user => user.email === 'ana@exemplo.com');
        const disconnected = once(socket, 'disconnect');
        events.emit('user.revoked', { userId: ana.id });
        expect(await disconnected).toBe('io server disconnect');
    });
});
