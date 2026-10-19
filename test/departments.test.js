import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';
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
    presence,
    distributor,
    server
} from './helpers.js';

const pipeline = server('../server/pipeline/index.js');

const app = createApp({ sessions: Sessions });
vi.spyOn(Sessions, 'launch').mockImplementation(() => undefined);
afterAll(() => disconnect());

let admin;
const agents = {};
const users = {};
let phone = 1;

async function login(email, password) {
    const session = request.agent(app);
    expect((await session.post('/api/v1/auth/login').send({ email, password })).status).toBe(200);
    return session;
}

/** Conversa nova de um contato novo (bot desligado: nasce na fila "Sem departamento"). */
async function newConversation() {
    const from = `5511900${String(phone++).padStart(5, '0')}@c.us`;
    const message = await history.recordIncoming('s1', incoming({ from }));
    return message.conversationId;
}

async function department(body) {
    const res = await admin.post('/api/v1/departments').send(body);
    expect(res.status).toBe(201);
    return res.body.data;
}

/** Painel aberto e "Disponível" ligado. */
async function goOnline(name) {
    presence.connected(users[name].id);
    await agents[name].patch('/api/v1/auth/me').send({ available: true });
    await distributor.settled();
}

const conversation = id => db().conversation.findUnique({ where: { id } });

beforeEach(async () => {
    await resetAll();
    admin = request.agent(app);
    await admin.post('/api/v1/auth/setup').send({ email: 'admin@x.com', name: 'Admin', password: 'senha-admin-1' });
    for (const name of ['ana', 'bia', 'caio']) {
        users[name] = (
            await admin
                .post('/api/v1/users')
                .send({ email: name + '@x.com', name, password: 'senha-' + name + '-1', role: 'agent' })
        ).body.data;
        agents[name] = await login(name + '@x.com', 'senha-' + name + '-1');
    }
    connect('s1');
});

describe('cadastro de departamentos', () => {
    it('admin cria e altera; atendente só consulta', async () => {
        expect((await agents.ana.post('/api/v1/departments').send({ name: 'Vendas' })).status).toBe(403);

        const vendas = await department({ name: 'Vendas', mode: 'distribuida', userIds: [users.ana.id] });
        expect(vendas).toMatchObject({ name: 'Vendas', mode: 'distribuida', active: true, pending: 0 });
        expect(vendas.members.map(member => member.name)).toEqual(['ana']);
        expect((await admin.post('/api/v1/departments').send({ name: 'Vendas' })).status).toBe(409);
        expect((await admin.post('/api/v1/departments').send({ name: 'X', userIds: [99999] })).status).toBe(400);

        const list = (await agents.ana.get('/api/v1/departments')).body.data;
        expect(list).toHaveLength(1);
        expect(list[0].mine).toBe(true);
        expect((await agents.bia.get('/api/v1/departments')).body.data[0].mine).toBe(false);

        const changed = await admin
            .patch('/api/v1/departments/' + vendas.id)
            .send({ mode: 'esteira', userIds: [users.bia.id, users.caio.id] });
        expect(changed.body.data.mode).toBe('esteira');
        expect(changed.body.data.members.map(member => member.name)).toEqual(['bia', 'caio']);
    });

    it('desativar ou remover manda a fila para "Sem departamento"', async () => {
        const suporte = await department({ name: 'Suporte' });
        const id = await newConversation();
        await admin.patch('/api/v1/conversations/' + id).send({ departmentId: suporte.id });
        expect((await conversation(id)).departmentId).toBe(suporte.id);

        await admin.patch('/api/v1/departments/' + suporte.id).send({ active: false });
        expect((await conversation(id)).departmentId).toBeNull();
        expect((await admin.get('/api/v1/departments')).body.data).toHaveLength(0);
        expect((await admin.get('/api/v1/departments?active=all')).body.data).toHaveLength(1);

        await admin.patch('/api/v1/departments/' + suporte.id).send({ active: true });
        await admin.patch('/api/v1/conversations/' + id).send({ departmentId: suporte.id });
        await admin.delete('/api/v1/departments/' + suporte.id);
        expect((await conversation(id)).departmentId).toBeNull();
    });
});

describe('bot transfere para o departamento', () => {
    async function useFlow(departmentId) {
        const definition = {
            nodes: [
                { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
                { id: 'h', type: 'handoff', position: { x: 0, y: 0 }, data: { text: 'Já te atendo', departmentId } }
            ],
            edges: [{ id: '1', source: 's', target: 'h' }]
        };
        const flow = await db().flow.create({ data: { name: 'F', definition, published: definition, version: 1 } });
        await db().session.create({ data: { name: 's1', engine: 'WPPCONNECT', botMode: 'flow', flowId: flow.id } });
    }

    async function talk() {
        const saved = await history.recordIncoming('s1', incoming());
        await pipeline.handle(Sessions, 's1', saved);
        return conversation(saved.conversationId);
    }

    it('bloco "Transferir" com departamento coloca na fila dele', async () => {
        const vendas = await department({ name: 'Vendas' });
        await useFlow(vendas.id);
        const result = await talk();
        expect(result).toMatchObject({ status: 'pending', departmentId: vendas.id, assignedUserId: null });
        expect(result.queuedAt).not.toBeNull();
    });

    it('departamento desativado ou inexistente: "Sem departamento"', async () => {
        const vendas = await department({ name: 'Vendas' });
        await admin.patch('/api/v1/departments/' + vendas.id).send({ active: false });
        await useFlow(vendas.id);
        expect(await talk()).toMatchObject({ status: 'pending', departmentId: null });
    });

    it('departamento distribuído já entrega para quem está disponível', async () => {
        const vendas = await department({ name: 'Vendas', mode: 'distribuida', userIds: [users.ana.id] });
        await goOnline('ana');
        await useFlow(vendas.id);
        expect(await talk()).toMatchObject({ status: 'open', departmentId: vendas.id, assignedUserId: users.ana.id });
    });

    it('IA transfere para o departamento do assistente', async () => {
        const previousKey = process.env.ANTHROPIC_API_KEY;
        delete process.env.ANTHROPIC_API_KEY;
        try {
            const suporte = await department({ name: 'Suporte' });
            const agent = (await admin.post('/api/v1/ai-agents').send({ name: 'Bot' })).body.data;
            await admin.patch('/api/v1/ai-agents/' + agent.id).send({ handoffDepartmentId: suporte.id });
            await db().session.create({
                data: { name: 's1', engine: 'WPPCONNECT', botMode: 'ai', aiAgentId: agent.id }
            });
            expect(await talk()).toMatchObject({ status: 'pending', departmentId: suporte.id });
        } finally {
            if (previousKey !== undefined) process.env.ANTHROPIC_API_KEY = previousKey;
        }
    });
});

describe('visibilidade', () => {
    it('atendente vê seus departamentos, a fila sem departamento e as suas', async () => {
        const vendas = await department({ name: 'Vendas', userIds: [users.ana.id] });
        const suporte = await department({ name: 'Suporte', userIds: [users.bia.id] });
        const semDepartamento = await newConversation();
        const deVendas = await newConversation();
        const deSuporte = await newConversation();
        await admin.patch('/api/v1/conversations/' + deVendas).send({ departmentId: vendas.id });
        await admin.patch('/api/v1/conversations/' + deSuporte).send({ departmentId: suporte.id });

        const ids = async name =>
            (await agents[name].get('/api/v1/conversations')).body.data.map(item => item.id).sort();
        expect(await ids('ana')).toEqual([semDepartamento, deVendas].sort());
        expect(await ids('bia')).toEqual([semDepartamento, deSuporte].sort());
        expect((await admin.get('/api/v1/conversations')).body.data).toHaveLength(3);

        expect((await agents.ana.get('/api/v1/conversations/' + deSuporte)).status).toBe(404);
        expect((await agents.ana.get('/api/v1/conversations/' + deSuporte + '/messages')).status).toBe(404);
        expect((await agents.ana.patch('/api/v1/conversations/' + deSuporte).send({ status: 'open' })).status).toBe(
            404
        );
        const message = await db().message.findFirst({ where: { conversationId: deSuporte } });
        expect((await agents.ana.get('/api/v1/messages/' + message.id)).status).toBe(404);

        // transferida para a Ana: passa a ver mesmo sem ser do Suporte
        await admin.patch('/api/v1/conversations/' + deSuporte).send({ status: 'open', assignedUserId: users.ana.id });
        expect((await agents.ana.get('/api/v1/conversations/' + deSuporte)).status).toBe(200);

        const filtered = await agents.ana.get('/api/v1/conversations?department=none');
        expect(filtered.body.data.map(item => item.id)).toEqual([semDepartamento]);
        expect((await agents.ana.get('/api/v1/conversations?department=' + vendas.id)).body.data[0]).toMatchObject({
            id: deVendas,
            department: { id: vendas.id, name: 'Vendas', mode: 'esteira' }
        });

        const stats = (await agents.bia.get('/api/v1/stats')).body.data;
        expect(stats.conversations.pending).toBe(1); // só a sem departamento (a do Suporte foi para a Ana)
    });
});

describe('esteira', () => {
    it('o atendente escolhe na fila; dois ao mesmo tempo: um recebe 409', async () => {
        const suporte = await department({ name: 'Suporte', userIds: [users.ana.id, users.bia.id] });
        const id = await newConversation();
        await admin.patch('/api/v1/conversations/' + id).send({ departmentId: suporte.id });

        const results = await Promise.all(
            ['ana', 'bia'].map(name => agents[name].patch('/api/v1/conversations/' + id).send({ status: 'open' }))
        );
        expect(results.map(res => res.status).sort()).toEqual([200, 409]);
        expect(results.find(res => res.status === 409).body.error.code).toBe('ALREADY_ASSIGNED');
    });

    it('transfere para outro departamento e devolve à fila do mesmo departamento', async () => {
        const vendas = await department({ name: 'Vendas', userIds: [users.ana.id] });
        const suporte = await department({ name: 'Suporte', userIds: [users.ana.id] });
        const id = await newConversation();
        await agents.ana.patch('/api/v1/conversations/' + id).send({ status: 'open' });

        const moved = await agents.ana.patch('/api/v1/conversations/' + id).send({ departmentId: vendas.id });
        expect(moved.body.data).toMatchObject({ status: 'pending', assignedUserId: null, departmentId: vendas.id });

        await agents.ana.patch('/api/v1/conversations/' + id).send({ status: 'open' });
        const back = await agents.ana.patch('/api/v1/conversations/' + id).send({ status: 'pending' });
        expect(back.body.data).toMatchObject({ status: 'pending', departmentId: vendas.id });

        const invalid = await agents.ana.patch('/api/v1/conversations/' + id).send({ departmentId: 99999 });
        expect(invalid.body.error.code).toBe('INVALID_DEPARTMENT');
        const mixed = await agents.ana
            .patch('/api/v1/conversations/' + id)
            .send({ departmentId: suporte.id, status: 'open' });
        expect(mixed.body.error.code).toBe('INVALID_TRANSFER');
    });
});

describe('distribuída', () => {
    let vendas;
    beforeEach(async () => {
        vendas = await department({
            name: 'Vendas',
            mode: 'distribuida',
            userIds: [users.ana.id, users.bia.id, users.caio.id]
        });
    });

    async function toVendas() {
        const id = await newConversation();
        await admin.patch('/api/v1/conversations/' + id).send({ departmentId: vendas.id });
        return id;
    }

    it('rodízio entre os disponíveis', async () => {
        for (const name of ['ana', 'bia', 'caio']) await goOnline(name);
        const order = [];
        for (let i = 0; i < 6; i++) order.push((await conversation(await toVendas())).assignedUserId);
        const [a, b, c] = order;
        expect(new Set([a, b, c]).size).toBe(3);
        expect(order).toEqual([a, b, c, a, b, c]);
    });

    it('pausado ou com o painel fechado não recebe', async () => {
        await goOnline('ana');
        await goOnline('bia');
        await agents.bia.patch('/api/v1/auth/me').send({ available: false });
        presence.connected(users.caio.id); // painel aberto, mas não ligou o "Disponível"
        for (let i = 0; i < 3; i++) await toVendas();
        const rows = await db().conversation.findMany({ where: { departmentId: vendas.id } });
        expect(rows.map(row => row.assignedUserId)).toEqual([users.ana.id, users.ana.id, users.ana.id]);
    });

    it('sem ninguém on-line espera na fila e é entregue quando alguém fica disponível', async () => {
        const first = await toVendas();
        const second = await toVendas();
        expect(await conversation(first)).toMatchObject({ status: 'pending', assignedUserId: null });

        // atendente não escolhe na fila distribuída
        const take = await agents.ana.patch('/api/v1/conversations/' + first).send({ status: 'open' });
        expect(take.body.error.code).toBe('DISTRIBUTED_QUEUE');
        const self = await agents.ana
            .patch('/api/v1/conversations/' + first)
            .send({ status: 'open', assignedUserId: users.ana.id });
        expect(self.body.error.code).toBe('DISTRIBUTED_QUEUE');
        const reply = await agents.ana
            .post('/api/v1/conversations/' + first + '/messages')
            .send({ type: 'text', text: 'oi' });
        expect(reply.body.error.code).toBe('DISTRIBUTED_QUEUE');

        await goOnline('bia');
        expect(await conversation(first)).toMatchObject({ status: 'open', assignedUserId: users.bia.id });
        expect(await conversation(second)).toMatchObject({ status: 'open', assignedUserId: users.bia.id });
    });

    it('admin pode atribuir manualmente', async () => {
        const id = await toVendas();
        const res = await admin
            .patch('/api/v1/conversations/' + id)
            .send({ status: 'open', assignedUserId: users.caio.id });
        expect(res.body.data.assignedUser.id).toBe(users.caio.id);
    });

    describe('presença', () => {
        afterEach(() => {
            presence.state.graceMs = 30000;
            vi.useRealTimers();
        });

        it('recarregar a página não tira do rodízio; fechar tira depois da carência', async () => {
            vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
            await goOnline('ana');
            const kept = await toVendas();

            presence.disconnected(users.ana.id);
            presence.connected(users.ana.id); // recarregou
            vi.advanceTimersByTime(60000);
            expect(presence.isConnected(users.ana.id)).toBe(true);

            presence.disconnected(users.ana.id);
            vi.advanceTimersByTime(10000);
            expect(presence.isConnected(users.ana.id)).toBe(true); // ainda na carência
            vi.advanceTimersByTime(30000);
            expect(presence.isConnected(users.ana.id)).toBe(false);

            const waiting = await toVendas();
            expect((await conversation(waiting)).status).toBe('pending');
            // quem saiu continua com as conversas que já tinha
            expect(await conversation(kept)).toMatchObject({ status: 'open', assignedUserId: users.ana.id });
        });
    });
});
