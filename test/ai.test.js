import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { resetAll, createApp, Sessions, history, db, disconnect, connect, incoming, server } from './helpers.js';

const ai = server('../server/pipeline/ai.js');
const pipeline = server('../server/pipeline/index.js');

const usage = (input = 100, output = 20) => ({
    input_tokens: input,
    output_tokens: output,
    cache_read_input_tokens: 0,
    cache_creation_input_tokens: 0
});
const text = value => ({ type: 'text', text: value });
const reply = (content, stop_reason = 'end_turn') => ({ content, stop_reason, usage: usage() });

/** Client falso: devolve as respostas em ordem e guarda as requisições. */
function fakeAnthropic(...responses) {
    const create = vi.fn(async () => {
        const next = responses.shift();
        if (next instanceof Error) throw next;
        return next;
    });
    return { beta: { messages: { create } }, create };
}

const agent = {
    model: 'claude-opus-5',
    effort: 'low',
    instructions: 'Seja breve.',
    knowledge: 'Abrimos das 8h às 18h.'
};
const msg = (direction, body, type = 'chat') => ({ direction, body, type });

describe('ai: montagem da conversa', () => {
    it('histórico vira user/assistant, sem notas, começando e terminando em user', () => {
        const messages = ai.toApiMessages(
            [
                msg('out', 'Olá! (bot)'),
                msg('in', 'oi'),
                msg('in', 'tudo bem?'),
                msg('note', 'interno'),
                msg('out', 'Tudo!'),
                msg('in', '', 'image'),
                msg('out', 'resposta pendente')
            ],
            '(contexto)'
        );
        expect(messages.map(message => message.role)).toEqual(['user', 'assistant', 'user']);
        expect(messages[0].content).toBe('oi\ntudo bem?');
        expect(messages[2].content).toEqual([text('[O cliente enviou uma imagem]'), text('(contexto)')]);
    });

    it('system com instruções e base de conhecimento', () => {
        const prompt = ai.systemPrompt(agent);
        expect(prompt).toContain('<instrucoes>\nSeja breve.\n</instrucoes>');
        expect(prompt).toContain('<base_de_conhecimento>\nAbrimos das 8h às 18h.\n</base_de_conhecimento>');
    });
});

describe('ai.respond', () => {
    it('Opus 5: thinking adaptativo, effort, cache, ferramentas estritas e fallback de recusa', async () => {
        const client = fakeAnthropic(reply([{ type: 'thinking', thinking: '' }, text('Abrimos às 8h! 😊')]));
        const result = await ai.respond(agent, [msg('in', 'que horas abre?')], { client, contact: { name: 'Ana' } });
        expect(result).toMatchObject({ replies: ['Abrimos às 8h! 😊'], effects: [], outcome: 'reply' });
        expect(result.usage).toMatchObject({ model: 'claude-opus-5', inputTokens: 100, outputTokens: 20 });
        const params = client.create.mock.calls[0][0];
        expect(params).toMatchObject({
            model: 'claude-opus-5',
            thinking: { type: 'adaptive' },
            output_config: { effort: 'low' },
            cache_control: { type: 'ephemeral' },
            betas: ['server-side-fallback-2026-07-01'],
            fallbacks: 'default'
        });
        expect(params.system[0].cache_control).toEqual({ type: 'ephemeral' });
        expect(params.tools.every(tool => tool.strict && tool.input_schema.additionalProperties === false)).toBe(true);
        expect(params.tool_choice).toBeUndefined();
        expect(params.temperature).toBeUndefined();
        expect(params.messages.at(-1).content[1].text).toContain('cliente "Ana"');
    });

    it('outros modelos não usam o fallback de recusa', async () => {
        const client = fakeAnthropic(reply([text('ok')]));
        await ai.respond({ ...agent, model: 'claude-haiku-4-5' }, [msg('in', 'oi')], { client });
        const params = client.create.mock.calls[0][0];
        expect(params.model).toBe('claude-haiku-4-5');
        expect(params.fallbacks).toBeUndefined();
    });

    it('transferência: executa a ferramenta, devolve o resultado e junta as respostas', async () => {
        const toolUse = {
            type: 'tool_use',
            id: 'tu_1',
            name: 'transfer_to_human',
            input: { reason: 'quer negociar desconto' }
        };
        const client = fakeAnthropic(reply([text('Vou chamar um atendente.'), toolUse], 'tool_use'), reply([]));
        const result = await ai.respond(agent, [msg('in', 'me dá desconto?')], { client });
        expect(result.replies).toEqual(['Vou chamar um atendente.']);
        expect(result.effects).toEqual([{ type: 'handoff', reason: 'ai', note: 'quer negociar desconto' }]);
        expect(result.outcome).toBe('handoff');
        expect(result.usage.inputTokens).toBe(200);
        const second = client.create.mock.calls[1][0].messages;
        expect(second.at(-2)).toEqual({ role: 'assistant', content: [text('Vou chamar um atendente.'), toolUse] });
        expect(second.at(-1).content[0]).toMatchObject({ type: 'tool_result', tool_use_id: 'tu_1' });
    });

    it('recusa vira transferência', async () => {
        const client = fakeAnthropic({ content: [], stop_reason: 'refusal', usage: usage() });
        const result = await ai.respond(agent, [msg('in', '...')], { client });
        expect(result).toMatchObject({ outcome: 'refusal', effects: [{ type: 'handoff', reason: 'refusal' }] });
    });

    it('custo estimado pela tabela de preços', () => {
        expect(
            ai.estimateCost('claude-opus-5', {
                inputTokens: 1e6,
                outputTokens: 1e6,
                cacheReadTokens: 0,
                cacheWriteTokens: 0
            })
        ).toBe(30);
        expect(
            ai.estimateCost('claude-haiku-4-5', {
                inputTokens: 0,
                outputTokens: 0,
                cacheReadTokens: 1e6,
                cacheWriteTokens: 0
            })
        ).toBeCloseTo(0.1);
    });
});

describe('pipeline com IA', () => {
    const previousKey = process.env.ANTHROPIC_API_KEY;
    beforeEach(async () => {
        await resetAll();
        process.env.ANTHROPIC_API_KEY = 'sk-test';
    });
    afterEach(() => {
        process.env.ANTHROPIC_API_KEY = previousKey;
        ai.setClient(null);
    });
    afterAll(() => disconnect());

    async function setup(agentData = {}) {
        const created = await db().aiAgent.create({ data: { name: 'Assistente', ...agentData } });
        await db().session.create({ data: { name: 's1', engine: 'WPPCONNECT', botMode: 'ai', aiAgentId: created.id } });
        return { agent: created, client: connect('s1') };
    }
    async function receive(body) {
        const saved = await history.recordIncoming('s1', incoming({ body }));
        await pipeline.handle(Sessions, 's1', saved);
        return db().conversation.findFirst({ orderBy: { id: 'desc' } });
    }

    it('responde com origem "ai" e registra o uso', async () => {
        const { client } = await setup();
        ai.setClient(fakeAnthropic(reply([text('Olá! Como posso ajudar?')])));
        const conversation = await receive('oi');
        expect(conversation).toMatchObject({ status: 'bot' });
        expect(client.sendText).toHaveBeenCalledWith('556334140378@c.us', 'Olá! Como posso ajudar?');
        expect((await db().message.findFirst({ where: { direction: 'out' } })).origin).toBe('ai');
        expect(await db().aiUsage.findFirst()).toMatchObject({ outcome: 'reply', inputTokens: 100, test: false });
    });

    it('transferência pela IA: fila + nota interna com o motivo', async () => {
        await setup();
        ai.setClient(
            fakeAnthropic(
                reply(
                    [
                        text('Vou te passar para um atendente.'),
                        {
                            type: 'tool_use',
                            id: 't',
                            name: 'transfer_to_human',
                            input: { reason: 'reclamação de entrega' }
                        }
                    ],
                    'tool_use'
                ),
                reply([])
            )
        );
        const conversation = await receive('meu pedido veio errado');
        expect(conversation).toMatchObject({ status: 'pending', flowState: null });
        const note = await db().message.findFirst({ where: { direction: 'note' } });
        expect(note.body).toBe('Transferido pelo bot: reclamação de entrega');
    });

    it('limite por hora transfere sem chamar a API; erro da API também transfere', async () => {
        await setup({ maxRepliesPerHour: 1 });
        const anthropic = fakeAnthropic(reply([text('primeira')]));
        ai.setClient(anthropic);
        await receive('oi');
        const limited = await receive('oi de novo');
        expect(anthropic.create).toHaveBeenCalledTimes(1);
        expect(limited.status).toBe('pending');

        await db().conversation.updateMany({ data: { status: 'bot' } });
        await db().aiAgent.updateMany({ data: { maxRepliesPerHour: 10 } });
        ai.setClient(fakeAnthropic(new Error('overloaded')));
        const failed = await receive('alô?');
        expect(failed.status).toBe('pending');
        expect(await db().aiUsage.count({ where: { outcome: 'error' } })).toBe(1);
    });

    it('sem ANTHROPIC_API_KEY a conversa vai para a fila', async () => {
        await setup();
        delete process.env.ANTHROPIC_API_KEY;
        const conversation = await receive('oi');
        expect(conversation.status).toBe('pending');
        expect((await db().message.findFirst({ where: { direction: 'note' } })).body).toMatch(/ANTHROPIC_API_KEY/);
    });

    it('bloco IA no fluxo: fluxo responde, a IA continua daqui em diante', async () => {
        const agent = await db().aiAgent.create({ data: { name: 'A' } });
        const definition = {
            nodes: [
                { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
                { id: 'm', type: 'message', position: { x: 0, y: 0 }, data: { text: 'Bem-vindo!' } },
                { id: 'i', type: 'ai', position: { x: 0, y: 0 }, data: { agentId: agent.id } }
            ],
            edges: [
                { id: '1', source: 's', target: 'm' },
                { id: '2', source: 'm', target: 'i' }
            ],
            settings: {}
        };
        const flow = await db().flow.create({ data: { name: 'F', definition, published: definition, version: 1 } });
        await db().session.create({ data: { name: 's1', engine: 'WPPCONNECT', botMode: 'flow', flowId: flow.id } });
        const client = connect('s1');
        const anthropic = fakeAnthropic(reply([text('Sou a IA, em que ajudo?')]), reply([text('Claro!')]));
        ai.setClient(anthropic);

        const first = await receive('oi');
        expect(client.sendText.mock.calls.map(call => call[1])).toEqual(['Bem-vindo!', 'Sou a IA, em que ajudo?']);
        expect(first.flowState).toMatchObject({ mode: 'ai', agentId: agent.id });
        await receive('quero ajuda');
        expect(client.sendText).toHaveBeenLastCalledWith('556334140378@c.us', 'Claro!');
        expect(anthropic.create).toHaveBeenCalledTimes(2);
    });
});

describe('API de IA', () => {
    const app = createApp({ sessions: Sessions });
    vi.spyOn(Sessions, 'launch').mockImplementation(() => undefined);
    const previousKey = process.env.ANTHROPIC_API_KEY;
    let admin;
    beforeEach(async () => {
        await resetAll();
        delete process.env.ANTHROPIC_API_KEY;
        admin = request.agent(app);
        await admin.post('/api/v1/auth/setup').send({ email: 'a@x.com', name: 'Admin', password: 'senha-forte-1' });
    });
    afterEach(() => {
        process.env.ANTHROPIC_API_KEY = previousKey;
        ai.setClient(null);
    });

    it('status, CRUD, ligar na sessão e não remover em uso', async () => {
        const status = await admin.get('/api/v1/ai/status');
        expect(status.body.data).toMatchObject({ available: false, defaultModel: 'claude-opus-5' });

        const created = await admin.post('/api/v1/ai-agents').send({ name: 'Atendente virtual' });
        expect(created.body.data).toMatchObject({
            model: 'claude-opus-5',
            effort: 'low',
            usage: { replies: 0, costUsd: 0 }
        });
        const id = created.body.data.id;
        const patched = await admin
            .patch('/api/v1/ai-agents/' + id)
            .send({ knowledge: 'Frete grátis acima de R$ 199.', model: 'claude-sonnet-5' });
        expect(patched.body.data).toMatchObject({
            model: 'claude-sonnet-5',
            knowledge: 'Frete grátis acima de R$ 199.'
        });
        expect((await admin.patch('/api/v1/ai-agents/' + id).send({ model: 'gpt-4' })).status).toBe(400);

        await admin.post('/api/v1/sessions').send({ name: 's1' });
        const on = await admin.patch('/api/v1/sessions/s1').send({ botMode: 'ai', aiAgentId: id });
        expect(on.body.data).toMatchObject({ botMode: 'ai', aiAgent: { id, name: 'Atendente virtual' } });
        expect((await admin.delete('/api/v1/ai-agents/' + id)).body.error.code).toBe('AI_AGENT_IN_USE');
    });

    it('playground: 503 sem chave; com chave devolve resposta e custo', async () => {
        const body = {
            agent: { knowledge: 'Abrimos às 8h.' },
            messages: [{ direction: 'in', body: 'que horas abre?' }]
        };
        expect((await admin.post('/api/v1/ai-agents/test').send(body)).body.error.code).toBe('AI_UNAVAILABLE');

        process.env.ANTHROPIC_API_KEY = 'sk-test';
        ai.setClient(fakeAnthropic(reply([text('Abrimos às 8h!')])));
        const res = await admin.post('/api/v1/ai-agents/test').send(body);
        expect(res.body.data).toMatchObject({ replies: ['Abrimos às 8h!'], outcome: 'reply' });
        expect(res.body.data.usage.costUsd).toBeGreaterThan(0);
        expect(await db().aiUsage.findFirst()).toMatchObject({ test: true });
    });
});
