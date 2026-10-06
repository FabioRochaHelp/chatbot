import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { resetAll, createApp, Sessions, history, db, disconnect, connect, incoming, server } from './helpers.js';

const flows = server('../server/pipeline/flows.js');
const { TEMPLATES } = server('../server/pipeline/templates.js');
const pipeline = server('../server/pipeline/index.js');

// segunda-feira 10h e domingo 10h em São Paulo (UTC-3)
const MONDAY = new Date('2026-10-05T13:00:00Z');
const SUNDAY = new Date('2026-10-04T13:00:00Z');
const contact = { name: 'Maria', number: '5563981112233' };

/** Conversa no motor: devolve as respostas de cada mensagem, mantendo o estado. */
function chat(definition, now = MONDAY, io = {}) {
    let state = null;
    return async input => {
        const result = await flows.run(
            definition,
            state,
            input,
            { contact, now },
            { sleep: async () => undefined, ...io }
        );
        state = result.state;
        return { ...result, state };
    };
}

describe('motor de fluxos', () => {
    it('modelo em branco: boas-vindas com o nome do contato', async () => {
        const result = await chat(TEMPLATES.blank())('oi');
        expect(result.replies).toEqual(['Olá, Maria! Obrigado por falar com a gente.']);
        expect(result.state).toBeNull();
    });

    it('menu: mostra opções, aceita número ou texto, valida pergunta e transfere com etiqueta', async () => {
        const send = chat(TEMPLATES.menu());
        const first = await send('bom dia');
        expect(first.replies[0]).toContain('Olá, Maria! 👋 Como podemos ajudar?');
        expect(first.replies[0]).toContain('*2* - Acompanhar um pedido');
        expect(first.state.nodeId).toBe('menu');

        expect((await send('2')).replies).toEqual(['Qual é o número do pedido?']);
        expect((await send('não sei')).replies).toEqual(['Digite só os números do pedido, por favor.']);
        const done = await send('4821');
        expect(done.replies).toEqual(['Obrigado! Um atendente vai verificar o pedido 4821 e já te responde.']);
        expect(done.effects).toEqual([
            { type: 'tag', tag: 'pedido' },
            { type: 'handoff', reason: 'flow' }
        ]);
        expect(done.state).toBeNull();
    });

    it('menu aceita o texto da opção sem acento/maiúscula', async () => {
        const send = chat(TEMPLATES.menu());
        await send('oi');
        const result = await send('  ACOMPANHAR um PEDIDO ');
        expect(result.replies).toEqual(['Qual é o número do pedido?']);
    });

    it('opção inválida repete o menu e, na terceira, transfere', async () => {
        const send = chat(TEMPLATES.menu());
        await send('oi');
        const wrong = await send('9');
        expect(wrong.replies[0]).toMatch(/Opção inválida/);
        expect(wrong.replies[1]).toContain('*1* - Fazer um pedido');
        await send('banana');
        const third = await send('xyz');
        expect(third.effects).toEqual([{ type: 'handoff', reason: 'invalid-option' }]);
    });

    it('fora do horário: avisa e encerra', async () => {
        const result = await chat(TEMPLATES.menu(), SUNDAY)('oi');
        expect(result.replies[0]).toMatch(/Nosso horário é de segunda a sexta/);
        expect(result.effects).toEqual([{ type: 'end', close: false }]);
    });

    it('palavra-chave "atendente" transfere em qualquer ponto', async () => {
        const send = chat(TEMPLATES.menu());
        await send('oi');
        const result = await send('quero falar com um atendente agora');
        expect(result.replies).toEqual(['Tudo bem! Vou te passar para um atendente. 🙂']);
        expect(result.effects[0].type).toBe('handoff');
    });

    it('estado vencido (inatividade) recomeça do início', async () => {
        const definition = TEMPLATES.menu();
        const started = await flows.run(definition, null, 'oi', { contact, now: MONDAY });
        const later = new Date(MONDAY.getTime() + 31 * 60000);
        const result = await flows.run(definition, started.state, '2', { contact, now: later });
        expect(result.replies[0]).toContain('Como podemos ajudar?');
    });

    it('condição e requisição HTTP com variáveis', async () => {
        const definition = {
            nodes: [
                { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
                {
                    id: 'q',
                    type: 'question',
                    position: { x: 0, y: 0 },
                    data: { text: 'CPF?', variable: 'cpf', validation: 'number' }
                },
                {
                    id: 'h',
                    type: 'http',
                    position: { x: 0, y: 0 },
                    data: { url: 'https://api.exemplo.com/clientes/{{cpf}}', saveAs: 'cliente' }
                },
                {
                    id: 'c',
                    type: 'condition',
                    position: { x: 0, y: 0 },
                    data: { rules: [{ id: 'vip', variable: 'cliente.plano', operator: 'equals', value: 'VIP' }] }
                },
                {
                    id: 'vip',
                    type: 'message',
                    position: { x: 0, y: 0 },
                    data: { text: 'Olá {{cliente.nome}}, cliente VIP!' }
                },
                { id: 'comum', type: 'message', position: { x: 0, y: 0 }, data: { text: 'Olá {{cliente.nome}}!' } },
                { id: 'erro', type: 'handoff', position: { x: 0, y: 0 }, data: { text: 'Sistema fora do ar.' } }
            ],
            edges: [
                { id: '1', source: 's', target: 'q' },
                { id: '2', source: 'q', target: 'h' },
                { id: '3', source: 'h', sourceHandle: 'success', target: 'c' },
                { id: '4', source: 'h', sourceHandle: 'error', target: 'erro' },
                { id: '5', source: 'c', sourceHandle: 'vip', target: 'vip' },
                { id: '6', source: 'c', sourceHandle: 'else', target: 'comum' }
            ]
        };
        const fetch = vi.fn(async url => ({
            ok: true,
            status: 200,
            text: async () => JSON.stringify({ nome: 'Ana', plano: url.endsWith('/123') ? 'vip' : 'básico' })
        }));
        const send = chat(definition, MONDAY, { fetch });
        await send('oi');
        expect((await send('123')).replies).toEqual(['Olá Ana, cliente VIP!']);
        expect(fetch).toHaveBeenCalledWith(
            'https://api.exemplo.com/clientes/123',
            expect.objectContaining({ method: 'GET' })
        );

        const failing = chat(definition, MONDAY, {
            fetch: async () => {
                throw new Error('ECONNREFUSED');
            }
        });
        await failing('oi');
        const error = await failing('999');
        expect(error.replies).toEqual(['Sistema fora do ar.']);
        expect(error.effects[0].type).toBe('handoff');
    });

    it('laço sem espera é interrompido e transfere', async () => {
        const definition = {
            nodes: [
                { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
                { id: 'a', type: 'tag', position: { x: 0, y: 0 }, data: { tag: 'x' } },
                { id: 'b', type: 'tag', position: { x: 0, y: 0 }, data: { tag: 'y' } }
            ],
            edges: [
                { id: '1', source: 's', target: 'a' },
                { id: '2', source: 'a', target: 'b' },
                { id: '3', source: 'b', target: 'a' }
            ]
        };
        const result = await chat(definition)('oi');
        expect(result.effects.at(-1)).toEqual({ type: 'handoff', reason: 'loop' });
    });

    it('validação: modelos são válidos; problemas apontam o bloco', () => {
        expect(flows.validate(TEMPLATES.menu()).errors).toEqual([]);
        expect(flows.validate(TEMPLATES.blank()).errors).toEqual([]);
        const broken = {
            nodes: [
                { id: 'm', type: 'menu', position: { x: 0, y: 0 }, data: { text: 'Escolha', options: [] } },
                { id: 'q', type: 'question', position: { x: 0, y: 0 }, data: { text: 'Nome?', variable: 'meu nome' } }
            ],
            edges: [{ id: 'e', source: 'm', target: 'nada' }]
        };
        const { errors } = flows.validate(broken);
        const messages = errors.map(error => error.message);
        expect(messages).toContain('O fluxo precisa de exatamente um bloco de início.');
        expect(messages).toContain('Menu sem opções.');
        expect(errors.find(error => error.nodeId === 'q').message).toMatch(/variável/);
        expect(messages).toContain('Há uma ligação para um bloco que não existe.');
    });
});

describe('pipeline (WhatsApp)', () => {
    afterAll(() => disconnect());
    beforeEach(resetAll);

    const simpleMenu = () => ({
        nodes: [
            { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
            {
                id: 'm',
                type: 'menu',
                position: { x: 0, y: 0 },
                data: {
                    text: 'Escolha:',
                    options: [
                        { id: 'a', label: 'Vendas' },
                        { id: 'b', label: 'Suporte' }
                    ]
                }
            },
            {
                id: 'v',
                type: 'end',
                position: { x: 0, y: 0 },
                data: { text: 'Vendas: https://loja.exemplo', close: true }
            },
            { id: 'h', type: 'handoff', position: { x: 0, y: 0 }, data: { text: 'Transferindo...' } }
        ],
        edges: [
            { id: '1', source: 's', target: 'm' },
            { id: '2', source: 'm', sourceHandle: 'a', target: 'v' },
            { id: '3', source: 'm', sourceHandle: 'b', target: 'h' }
        ],
        settings: {}
    });

    async function setup() {
        const definition = simpleMenu();
        const flow = await db().flow.create({ data: { name: 'Menu', definition, published: definition, version: 1 } });
        await db().session.create({ data: { name: 's1', engine: 'WPPCONNECT', botMode: 'flow', flowId: flow.id } });
        return connect('s1');
    }

    async function receive(body) {
        const saved = await history.recordIncoming('s1', incoming({ body }));
        await pipeline.handle(Sessions, 's1', saved);
        return db().conversation.findFirst({ orderBy: { id: 'desc' } });
    }

    it('responde com o menu e guarda o estado; opção de suporte vai para a fila', async () => {
        const client = await setup();
        const conversation = await receive('olá');
        expect(conversation.status).toBe('bot');
        expect(conversation.flowState.nodeId).toBe('m');
        expect(client.sendText).toHaveBeenCalledWith('556334140378@c.us', expect.stringContaining('*1* - Vendas'));

        const after = await receive('2');
        expect(after).toMatchObject({ status: 'pending', flowState: null });
        expect(client.sendText).toHaveBeenLastCalledWith('556334140378@c.us', 'Transferindo...');
        const origins = (await db().message.findMany({ where: { direction: 'out' } })).map(message => message.origin);
        expect(origins).toEqual(['bot', 'bot']);
    });

    it('fim com encerrar fecha a conversa; próxima mensagem abre outra com o bot', async () => {
        await setup();
        await receive('oi');
        const closed = await receive('1');
        expect(closed.status).toBe('closed');
        const next = await receive('oi de novo');
        expect(next.id).not.toBe(closed.id);
        expect(next.status).toBe('bot');
    });

    it('não responde em conversa com atendente', async () => {
        const client = await setup();
        await receive('oi');
        await db().conversation.updateMany({ data: { status: 'open' } });
        client.sendText.mockClear();
        await receive('1');
        expect(client.sendText).not.toHaveBeenCalled();
    });
});

describe('API de fluxos', () => {
    const app = createApp({ sessions: Sessions });
    vi.spyOn(Sessions, 'launch').mockImplementation(() => undefined);
    let admin;

    beforeEach(async () => {
        await resetAll();
        admin = request.agent(app);
        await admin.post('/api/v1/auth/setup').send({ email: 'a@x.com', name: 'Admin', password: 'senha-forte-1' });
    });

    it('cria do modelo, publica, edita rascunho e simula', async () => {
        const created = await admin.post('/api/v1/flows').send({ name: 'Atendimento', template: 'menu' });
        expect(created.status).toBe(201);
        expect(created.body.data).toMatchObject({ version: 0, draftChanged: true, published: null });
        const id = created.body.data.id;

        const published = await admin.post(`/api/v1/flows/${id}/publish`);
        expect(published.body.data).toMatchObject({ version: 1, draftChanged: false });

        const definition = { ...created.body.data.definition, nodes: created.body.data.definition.nodes.slice(0, 1) };
        const edited = await admin.patch(`/api/v1/flows/${id}`).send({ definition });
        expect(edited.body.data.draftChanged).toBe(true);
        const invalid = await admin.post(`/api/v1/flows/${id}/publish`);
        expect(invalid.status).toBe(422);
        expect(invalid.body.error.details.errors.map(error => error.message)).toContain(
            'Há uma ligação para um bloco que não existe.'
        );

        const simulated = await admin
            .post('/api/v1/flows/simulate')
            .send({ definition: created.body.data.definition, input: 'oi', contact: { name: 'Teste' } });
        expect(simulated.body.data.trace[0]).toBe('start');
        expect(simulated.body.data.replies.length).toBeGreaterThan(0);
    });

    it('sessão: exige fluxo para ligar o bot; desligar manda conversas do bot para a fila', async () => {
        await admin.post('/api/v1/sessions').send({ name: 's1' });
        const noFlow = await admin.patch('/api/v1/sessions/s1').send({ botMode: 'flow' });
        expect(noFlow.body.error.code).toBe('FLOW_REQUIRED');

        const flow = (await admin.post('/api/v1/flows').send({ name: 'F', template: 'blank' })).body.data;
        await admin.post(`/api/v1/flows/${flow.id}/publish`);
        const on = await admin.patch('/api/v1/sessions/s1').send({ botMode: 'flow', flowId: flow.id });
        expect(on.body.data).toMatchObject({ botMode: 'flow', flow: { id: flow.id, name: 'F', version: 1 } });

        await history.recordIncoming('s1', incoming());
        expect((await db().conversation.findFirst()).status).toBe('bot');
        await admin.patch('/api/v1/sessions/s1').send({ botMode: 'off' });
        expect((await db().conversation.findFirst()).status).toBe('pending');

        const inUse = await admin.delete(`/api/v1/flows/${flow.id}`);
        expect(inUse.body.error.code).toBe('FLOW_IN_USE');
    });

    it('atendente não acessa fluxos', async () => {
        await admin.post('/api/v1/users').send({ email: 'b@x.com', name: 'B', password: 'senha-b-123', role: 'agent' });
        const agent = request.agent(app);
        await agent.post('/api/v1/auth/login').send({ email: 'b@x.com', password: 'senha-b-123' });
        expect((await agent.get('/api/v1/flows')).status).toBe(403);
    });
});
