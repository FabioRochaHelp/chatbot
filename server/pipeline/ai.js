'use strict';

/**
 * Respostas por IA (Claude) para conversas do WhatsApp.
 *
 * respond() recebe o assistente, o histórico e o contato e devolve { replies, effects, usage, outcome }.
 * O client da Anthropic é injetável (testes / simulador); por padrão usa ANTHROPIC_API_KEY do ambiente.
 */

const config = require('../config');
const log = require('../logger');

const MODELS = {
    'claude-opus-5': { label: 'Claude Opus 5', input: 5, output: 25 },
    'claude-sonnet-5': { label: 'Claude Sonnet 5', input: 2, output: 10 },
    'claude-haiku-4-5': { label: 'Claude Haiku 4.5', input: 1, output: 5 }
};
const DEFAULT_MODEL = 'claude-opus-5';
// cache: leitura ~0,1x e escrita ~1,25x o preço de entrada
const CACHE_READ = 0.1;
const CACHE_WRITE = 1.25;
const MAX_TOOL_ROUNDS = 3;
// respostas de WhatsApp são curtas; a folga cobre o raciocínio (thinking) que conta no limite
const MAX_TOKENS = 4096;

const TOOLS = [
    {
        name: 'transfer_to_human',
        description:
            'Transfere a conversa para a fila de atendentes humanos. Use quando o cliente pedir para falar com uma pessoa, ' +
            'quando a resposta não estiver na base de conhecimento, em reclamações, negociações, cancelamentos, ' +
            'pagamentos ou qualquer caso em que errar traria prejuízo ao cliente.',
        input_schema: {
            type: 'object',
            properties: { reason: { type: 'string', description: 'Motivo curto, visível para o atendente.' } },
            required: ['reason'],
            additionalProperties: false
        },
        strict: true
    },
    {
        name: 'end_conversation',
        description:
            'Encerra a conversa quando o assunto foi resolvido e o cliente se despediu ou agradeceu sem novas perguntas.',
        input_schema: {
            type: 'object',
            properties: { summary: { type: 'string', description: 'Resumo de uma linha do atendimento.' } },
            required: ['summary'],
            additionalProperties: false
        },
        strict: true
    }
];

function available() {
    return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}

let defaultClient = null;
/** Troca o client da Anthropic (testes). */
function setClient(client) {
    defaultClient = client;
}
function getClient() {
    if (!defaultClient) {
        const Anthropic = require('@anthropic-ai/sdk').default;
        defaultClient = new Anthropic({ timeout: 60000, maxRetries: 2 });
    }
    return defaultClient;
}

/** System prompt estável (fica em cache): instruções + base de conhecimento. */
function systemPrompt(agent) {
    const parts = [
        'Você é o assistente virtual que atende clientes pelo WhatsApp em nome da empresa descrita abaixo. ' +
            'Responda em português do Brasil, de forma cordial, direta e curta, como numa conversa de WhatsApp: ' +
            'poucas frases, sem títulos nem markdown; se precisar destacar algo use *negrito* do WhatsApp.',
        'Baseie as respostas apenas nas instruções e na base de conhecimento. Se a informação não estiver lá, não invente ' +
            '(preços, prazos, estoque, políticas): diga que vai chamar um atendente e use transfer_to_human. ' +
            'Use as ferramentas sem anunciar o nome delas para o cliente.'
    ];
    if (agent.instructions && agent.instructions.trim()) {
        parts.push('<instrucoes>\n' + agent.instructions.trim() + '\n</instrucoes>');
    }
    if (agent.knowledge && agent.knowledge.trim()) {
        parts.push('<base_de_conhecimento>\n' + agent.knowledge.trim() + '\n</base_de_conhecimento>');
    }
    return parts.join('\n\n');
}

const MEDIA_LABEL = {
    image: 'uma imagem',
    video: 'um vídeo',
    audio: 'um áudio',
    ptt: 'um áudio',
    document: 'um documento',
    sticker: 'uma figurinha',
    location: 'uma localização',
    vcard: 'um contato'
};

/** Texto de uma mensagem do histórico (mídia vira descrição; a IA não ouve áudio nem vê imagem aqui). */
function messageText(message) {
    const label = MEDIA_LABEL[message.type];
    const text = message.body || message.caption || '';
    if (label)
        return `[${message.direction === 'in' ? 'O cliente enviou' : 'Enviado'} ${label}${text ? ': ' + text : ''}]`;
    return text;
}

/**
 * Histórico -> mensagens da API: recebidas = user, enviadas (bot, IA, atendente) = assistant.
 * Notas internas ficam de fora. Começa em user e termina em user (sem prefill).
 */
function toApiMessages(history, contextLine) {
    const messages = [];
    for (const message of history) {
        if (message.direction === 'note') continue;
        const text = messageText(message).trim();
        if (!text) continue;
        const role = message.direction === 'in' ? 'user' : 'assistant';
        const last = messages[messages.length - 1];
        if (last && last.role === role) last.content += '\n' + text;
        else messages.push({ role, content: text });
    }
    while (messages.length && messages[0].role !== 'user') messages.shift();
    while (messages.length && messages[messages.length - 1].role !== 'user') messages.pop();
    if (messages.length) {
        // contexto que muda a cada mensagem vai no fim, para não invalidar o cache do system/histórico
        const last = messages[messages.length - 1];
        last.content = [
            { type: 'text', text: last.content },
            { type: 'text', text: contextLine }
        ];
    }
    return messages;
}

function contextLine(contact, now) {
    const when = now.toLocaleString('pt-BR', {
        timeZone: config.timezone || 'America/Sao_Paulo',
        dateStyle: 'full',
        timeStyle: 'short'
    });
    return `(Contexto do sistema, não mostrado ao cliente: cliente "${contact.name || 'sem nome'}"; agora é ${when}.)`;
}

function addUsage(total, usage) {
    if (!usage) return total;
    total.inputTokens += usage.input_tokens || 0;
    total.outputTokens += usage.output_tokens || 0;
    total.cacheReadTokens += usage.cache_read_input_tokens || 0;
    total.cacheWriteTokens += usage.cache_creation_input_tokens || 0;
    return total;
}

/** Custo estimado em US$ (tabela de preços por milhão de tokens). */
function estimateCost(model, usage) {
    const price = MODELS[model] || MODELS[DEFAULT_MODEL];
    return (
        ((usage.inputTokens + usage.cacheReadTokens * CACHE_READ + usage.cacheWriteTokens * CACHE_WRITE) * price.input +
            usage.outputTokens * price.output) /
        1e6
    );
}

/**
 * @param agent   { model, effort, instructions, knowledge }
 * @param history mensagens do histórico (as últimas N), em ordem
 * @param options { contact, now, client }
 */
async function respond(agent, history, options = {}) {
    const client = options.client || getClient();
    const model = MODELS[agent.model] ? agent.model : DEFAULT_MODEL;
    const messages = toApiMessages(history, contextLine(options.contact || {}, options.now || new Date()));
    const usage = { model, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
    const replies = [];
    const effects = [];
    if (!messages.length) return { replies, effects, usage, outcome: 'reply' };

    const request = {
        model,
        max_tokens: MAX_TOKENS,
        // instruções + base de conhecimento estáveis: ponto de cache explícito
        system: [{ type: 'text', text: systemPrompt(agent), cache_control: { type: 'ephemeral' } }],
        // cache automático no último bloco: o histórico da conversa é reaproveitado entre as mensagens
        cache_control: { type: 'ephemeral' },
        tools: TOOLS,
        thinking: { type: 'adaptive' },
        output_config: { effort: ['low', 'medium', 'high'].includes(agent.effort) ? agent.effort : 'low' }
    };
    // recusa por segurança: a API refaz a resposta com o modelo de reserva na mesma chamada
    if (model === 'claude-opus-5') {
        request.betas = ['server-side-fallback-2026-07-01'];
        request.fallbacks = 'default';
    }

    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
        const response = await client.beta.messages.create({ ...request, messages });
        addUsage(usage, response.usage);

        if (response.stop_reason === 'refusal') {
            effects.push({ type: 'handoff', reason: 'refusal' });
            return { replies, effects, usage, outcome: 'refusal' };
        }
        for (const block of response.content) {
            if (block.type === 'text' && block.text.trim()) replies.push(block.text.trim());
        }
        const calls = response.content.filter(block => block.type === 'tool_use');
        if (response.stop_reason !== 'tool_use' || calls.length === 0) {
            const outcome = effects.some(effect => effect.type === 'handoff')
                ? 'handoff'
                : effects.some(effect => effect.type === 'end')
                  ? 'end'
                  : 'reply';
            return { replies, effects, usage, outcome };
        }

        const results = [];
        for (const call of calls) {
            if (call.name === 'transfer_to_human') {
                effects.push({ type: 'handoff', reason: 'ai', note: String(call.input?.reason || '') });
                results.push({
                    type: 'tool_result',
                    tool_use_id: call.id,
                    content:
                        'Transferência registrada. Se ainda não avisou o cliente, escreva uma frase curta avisando que um atendente vai continuar; se já avisou, não escreva nada.'
                });
            } else if (call.name === 'end_conversation') {
                effects.push({ type: 'end', close: true, note: String(call.input?.summary || '') });
                results.push({
                    type: 'tool_result',
                    tool_use_id: call.id,
                    content:
                        'Conversa encerrada. Se ainda não se despediu, escreva uma despedida curta; senão, não escreva nada.'
                });
            } else {
                results.push({
                    type: 'tool_result',
                    tool_use_id: call.id,
                    content: 'Ferramenta desconhecida.',
                    is_error: true
                });
            }
        }
        // conteúdo completo (inclusive thinking) volta sem alteração
        messages.push({ role: 'assistant', content: response.content });
        messages.push({ role: 'user', content: results });
    }
    log.warn('IA passou do limite de rodadas de ferramenta');
    return { replies, effects, usage, outcome: effects.length ? 'handoff' : 'reply' };
}

module.exports = { respond, available, setClient, estimateCost, systemPrompt, toApiMessages, MODELS, DEFAULT_MODEL };
