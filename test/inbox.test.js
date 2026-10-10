import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { resetAll, createApp, Sessions, history, db, disconnect, connect, fakeClient, incoming } from './helpers.js';

const app = createApp({ sessions: Sessions });
vi.spyOn(Sessions, 'launch').mockImplementation(() => undefined);
afterAll(() => disconnect());

let admin;
let agent;
let agentUser;
let client;

async function login(email, password) {
    const session = request.agent(app);
    expect((await session.post('/api/v1/auth/login').send({ email, password })).status).toBe(200);
    return session;
}

beforeEach(async () => {
    await resetAll();
    admin = request.agent(app);
    await admin.post('/api/v1/auth/setup').send({ email: 'admin@x.com', name: 'Admin', password: 'senha-admin-1' });
    agentUser = (
        await admin
            .post('/api/v1/users')
            .send({ email: 'ana@x.com', name: 'Ana', password: 'senha-ana-1', role: 'agent' })
    ).body.data;
    agent = await login('ana@x.com', 'senha-ana-1');
    client = connect('s1', fakeClient({ sendSeen: vi.fn(async () => ({})) }));
    await history.recordIncoming('s1', incoming({ body: 'preciso de ajuda' }));
});

const firstConversation = async () => (await agent.get('/api/v1/conversations')).body.data[0];

describe('atribuição', () => {
    it('atendente assume, filtra as suas, transfere, devolve ao bot e encerra', async () => {
        const conversation = await firstConversation();
        expect(conversation).toMatchObject({ status: 'pending', assignedUser: null });

        const taken = await agent.patch('/api/v1/conversations/' + conversation.id).send({ status: 'open' });
        expect(taken.body.data).toMatchObject({ status: 'open', assignedUser: { id: agentUser.id, name: 'Ana' } });
        expect((await agent.get('/api/v1/conversations?assigned=me')).body.data).toHaveLength(1);
        expect((await agent.get('/api/v1/conversations?assigned=none')).body.data).toHaveLength(0);
        expect((await agent.get('/api/v1/conversations?status=pending,open')).body.data).toHaveLength(1);

        const me = (await admin.get('/api/v1/auth/me')).body.data.user;
        const moved = await agent
            .patch('/api/v1/conversations/' + conversation.id)
            .send({ status: 'open', assignedUserId: me.id });
        expect(moved.body.data.assignedUser.name).toBe('Admin');
        expect((await agent.get('/api/v1/conversations?assigned=me')).body.data).toHaveLength(0);

        const bot = await agent.patch('/api/v1/conversations/' + conversation.id).send({ status: 'bot' });
        expect(bot.body.data).toMatchObject({ status: 'bot', assignedUserId: null });

        const closed = await agent.patch('/api/v1/conversations/' + conversation.id).send({ status: 'closed' });
        expect(closed.body.data.closedAt).not.toBeNull();
    });

    it('não transfere para usuário desativado; integração precisa informar o atendente', async () => {
        const conversation = await firstConversation();
        await admin.patch('/api/v1/users/' + agentUser.id).send({ active: false });
        const invalid = await admin
            .patch('/api/v1/conversations/' + conversation.id)
            .send({ status: 'open', assignedUserId: agentUser.id });
        expect(invalid.body.error.code).toBe('INVALID_ASSIGNEE');

        const key = (await admin.post('/api/v1/api-keys').send({ name: 'crm' })).body.data.key;
        const integration = await request(app)
            .patch('/api/v1/conversations/' + conversation.id)
            .set('Authorization', 'Bearer ' + key)
            .send({ status: 'open' });
        expect(integration.body.error.code).toBe('ASSIGNEE_REQUIRED');
    });

    it('marcar como lida zera o contador e avisa o celular', async () => {
        const conversation = await firstConversation();
        expect(conversation.unreadCount).toBe(1);
        const read = await agent.patch('/api/v1/conversations/' + conversation.id).send({ read: true });
        expect(read.body.data.unreadCount).toBe(0);
        await vi.waitFor(() => expect(client.sendSeen).toHaveBeenCalledWith('556334140378@c.us'));
    });

    it('diretório de atendentes disponível para o atendente', async () => {
        const directory = await agent.get('/api/v1/users/directory');
        expect(directory.body.data.map(user => user.name)).toEqual(['Admin', 'Ana']);
        expect(directory.body.data[0]).not.toHaveProperty('email');
    });
});

describe('respostas do atendente e notas', () => {
    it('responder assume a conversa e grava origem agent com o nome', async () => {
        const conversation = await firstConversation();
        const reply = await agent
            .post('/api/v1/conversations/' + conversation.id + '/messages')
            .send({ type: 'text', text: 'Olá, sou a Ana' });
        expect(reply.status).toBe(201);
        expect(reply.body.data).toMatchObject({
            origin: 'agent',
            sentBy: { name: 'Ana' },
            conversationId: conversation.id
        });
        const after = (await agent.get('/api/v1/conversations/' + conversation.id)).body.data;
        expect(after).toMatchObject({ status: 'open', assignedUser: { name: 'Ana' } });
    });

    it('responder conversa encerrada reabre a mesma conversa', async () => {
        const conversation = await firstConversation();
        await agent.patch('/api/v1/conversations/' + conversation.id).send({ status: 'closed' });
        const reply = await agent
            .post('/api/v1/conversations/' + conversation.id + '/messages')
            .send({ type: 'text', text: 'voltando' });
        expect(reply.body.data.conversationId).toBe(conversation.id);
        expect(await db().conversation.count()).toBe(1);
        expect((await agent.get('/api/v1/conversations/' + conversation.id)).body.data.status).toBe('open');
    });

    it('nota interna não vai para o WhatsApp nem vira a última mensagem', async () => {
        const conversation = await firstConversation();
        const note = await agent
            .post('/api/v1/conversations/' + conversation.id + '/notes')
            .send({ text: 'cliente VIP, priorizar' });
        expect(note.status).toBe(201);
        expect(note.body.data).toMatchObject({ direction: 'note', type: 'note', sentBy: { name: 'Ana' } });
        expect(client.sendText).not.toHaveBeenCalled();
        const thread = (await agent.get('/api/v1/conversations/' + conversation.id + '/messages')).body.data;
        expect(thread.map(message => message.direction)).toEqual(['in', 'note']);
        expect((await firstConversation()).lastMessage.body).toBe('preciso de ajuda');
    });
});

describe('respostas rápidas', () => {
    it('admin gerencia, atendente só lista', async () => {
        const created = await admin
            .post('/api/v1/quick-replies')
            .send({ shortcut: 'Horario', text: 'Atendemos das 8h às 18h.' });
        expect(created.status).toBe(201);
        expect(created.body.data.shortcut).toBe('horario');
        expect((await admin.post('/api/v1/quick-replies').send({ shortcut: 'horario', text: 'x' })).status).toBe(409);
        expect((await admin.post('/api/v1/quick-replies').send({ shortcut: 'com espaço', text: 'x' })).status).toBe(
            400
        );

        expect((await agent.get('/api/v1/quick-replies')).body.data).toHaveLength(1);
        expect((await agent.post('/api/v1/quick-replies').send({ shortcut: 'oi', text: 'x' })).status).toBe(403);

        const id = created.body.data.id;
        const patched = await admin.patch('/api/v1/quick-replies/' + id).send({ text: 'Das 9h às 18h.' });
        expect(patched.body.data.text).toBe('Das 9h às 18h.');
        await admin.delete('/api/v1/quick-replies/' + id);
        expect((await agent.get('/api/v1/quick-replies')).body.data).toHaveLength(0);
    });
});
