'use strict';

/**
 * Motor de fluxos. Definição: { nodes: [{ id, type, position, data }], edges: [{ id, source, sourceHandle, target }],
 * settings: { timeoutMinutes, handoffKeywords, handoffText } }.
 *
 * run() é puro em relação ao mundo externo: HTTP e espera vêm de io, e o resultado diz o que fazer
 * ({ replies, effects, state, trace }). O pipeline aplica os efeitos no WhatsApp; o simulador só mostra.
 */

const MAX_STEPS = 100;
const DEFAULT_TIMEOUT_MINUTES = 30;
const MAX_DELAY_SECONDS = 30;
const HTTP_TIMEOUT_MS = 10000;

const NODE_TYPES = [
    'start',
    'message',
    'menu',
    'question',
    'condition',
    'businessHours',
    'delay',
    'http',
    'tag',
    'handoff',
    'end'
];

// ---------- utilitários ----------

/** minúsculas, sem acento e sem espaços extras: "  Olá " -> "ola" */
function normalize(value) {
    return String(value ?? '')
        .normalize('NFD')
        .replace(/[̀-ͯ]/g, '')
        .toLowerCase()
        .replace(/\s+/g, ' ')
        .trim();
}

function lookup(vars, path) {
    return String(path)
        .split('.')
        .reduce((value, key) => (value == null ? undefined : value[key]), vars);
}

/** "Olá {{contact.name}}" com as variáveis da conversa. */
function render(text, vars) {
    return String(text ?? '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (match, path) => {
        const value = lookup(vars, path);
        if (value == null) return '';
        return typeof value === 'object' ? JSON.stringify(value) : String(value);
    });
}

function menuText(data) {
    const options = (data.options || []).map((option, index) => `*${index + 1}* - ${option.label}`);
    return [data.text, options.join('\n')].filter(Boolean).join('\n\n');
}

function matchOption(options, input) {
    const answer = normalize(input).replace(/[.)\-:]+$/, '');
    if (!answer) return null;
    return (
        options.find((option, index) => answer === String(index + 1)) ||
        options.find(option => normalize(option.label) === answer) ||
        // "1 - Pedidos", "1) pedidos"
        options.find((option, index) => new RegExp('^' + (index + 1) + '\\b').test(answer)) ||
        null
    );
}

const VALIDATORS = {
    any: value => value.trim().length > 0,
    number: value => /^-?\d+([.,]\d+)?$/.test(value.trim()),
    email: value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()),
    phone: value => /^\d{8,15}$/.test(value.replace(/[\s()+.-]/g, ''))
};

const WEEKDAYS = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };

/** Dia da semana (0 = domingo) e minutos desde meia-noite no fuso informado. */
function localTime(date, timeZone) {
    const parts = Object.fromEntries(
        new Intl.DateTimeFormat('en-US', {
            timeZone,
            weekday: 'short',
            hour: '2-digit',
            minute: '2-digit',
            hourCycle: 'h23'
        })
            .formatToParts(date)
            .map(part => [part.type, part.value])
    );
    return { day: WEEKDAYS[parts.weekday], minutes: Number(parts.hour) * 60 + Number(parts.minute) };
}

const toMinutes = time => {
    const [hours, minutes] = String(time || '0:0')
        .split(':')
        .map(Number);
    return hours * 60 + (minutes || 0);
};

function isOpen(data, now) {
    const { day, minutes } = localTime(now, data.timezone || 'America/Sao_Paulo');
    return (data.schedule || []).some(
        slot => (slot.days || []).includes(day) && minutes >= toMinutes(slot.start) && minutes < toMinutes(slot.end)
    );
}

function evaluate(rule, vars, input) {
    const raw = rule.variable === 'message' || !rule.variable ? input : lookup(vars, rule.variable);
    const subject = normalize(raw);
    const expected = normalize(rule.value);
    switch (rule.operator) {
        case 'equals':
            return subject === expected;
        case 'contains':
            return expected.length > 0 && subject.includes(expected);
        case 'startsWith':
            return expected.length > 0 && subject.startsWith(expected);
        case 'regex':
            try {
                return new RegExp(rule.value, 'i').test(String(raw ?? ''));
            } catch (error) {
                return false;
            }
        case 'exists':
            return raw != null && String(raw).trim() !== '';
        default:
            return false;
    }
}

function wantsHuman(settings, input) {
    const answer = normalize(input);
    if (!answer) return false;
    return (settings.handoffKeywords || []).some(keyword => {
        const word = normalize(keyword);
        return (
            word &&
            (answer === word ||
                new RegExp('(^|\\s)' + word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\s|$)').test(answer))
        );
    });
}

async function httpCall(data, vars, io) {
    const url = render(data.url, vars);
    if (!/^https?:\/\//i.test(url)) throw new Error('URL inválida: ' + url);
    const method = (data.method || 'GET').toUpperCase();
    const init = { method, headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(HTTP_TIMEOUT_MS) };
    if (method !== 'GET' && data.body) {
        init.headers['Content-Type'] = 'application/json';
        init.body = render(data.body, vars);
    }
    const response = await io.fetch(url, init);
    const text = await response.text();
    let body = text;
    try {
        body = JSON.parse(text);
    } catch (error) {
        // resposta não é JSON: guarda o texto
    }
    return { ok: response.ok, status: response.status, body };
}

// ---------- execução ----------

/**
 * Executa o fluxo a partir do estado salvo da conversa.
 * @param definition fluxo publicado
 * @param state      estado anterior ({ nodeId, vars, attempts, updatedAt }) ou null
 * @param input      texto da mensagem recebida
 * @param context    { contact: { name, number }, now: Date }
 * @param io         { fetch, sleep } (o simulador pode desligar a espera)
 */
async function run(definition, state, input, context = {}, io = {}) {
    const nodes = new Map((definition.nodes || []).map(node => [node.id, node]));
    const edges = definition.edges || [];
    const settings = definition.settings || {};
    const now = context.now || new Date();
    const env = { fetch: io.fetch || globalThis.fetch, sleep: io.sleep || (ms => new Promise(r => setTimeout(r, ms))) };

    const replies = [];
    const effects = [];
    const trace = [];
    const next = (nodeId, handle) => {
        const edge = edges.find(item => item.source === nodeId && (item.sourceHandle || null) === (handle || null));
        return edge ? nodes.get(edge.target) || null : null;
    };
    const finish = () => ({ replies, effects, trace, state: null });

    const timeout = (settings.timeoutMinutes || DEFAULT_TIMEOUT_MINUTES) * 60000;
    const expired = state && state.updatedAt && now.getTime() - new Date(state.updatedAt).getTime() > timeout;
    const resuming = Boolean(state && state.nodeId && !expired && nodes.has(state.nodeId));
    const vars = { ...(resuming ? state.vars : {}), contact: context.contact || {} };

    // "atendente", "humano"... em qualquer ponto do fluxo
    if (wantsHuman(settings, input)) {
        if (settings.handoffText) replies.push(render(settings.handoffText, vars));
        effects.push({ type: 'handoff', reason: 'keyword' });
        return finish();
    }

    let node = resuming ? nodes.get(state.nodeId) : [...nodes.values()].find(item => item.type === 'start');
    if (!node) return finish();
    // a mensagem que inicia o fluxo não é resposta de nenhuma pergunta
    let answer = resuming ? input : null;
    let attempts = resuming ? state.attempts || 0 : 0;
    const wait = () => ({
        replies,
        effects,
        trace,
        state: { nodeId: node.id, vars: { ...vars, contact: undefined }, attempts, updatedAt: now.toISOString() }
    });

    for (let step = 0; step < MAX_STEPS && node; step++) {
        trace.push(node.id);
        const data = node.data || {};
        switch (node.type) {
            case 'start':
                node = next(node.id);
                break;

            case 'message':
                if (data.text) replies.push(render(data.text, vars));
                node = next(node.id);
                break;

            case 'menu': {
                if (answer === null) {
                    replies.push(render(menuText(data), vars));
                    return wait();
                }
                const option = matchOption(data.options || [], answer);
                answer = null;
                if (option) {
                    attempts = 0;
                    if (data.variable) vars[data.variable] = option.label;
                    node = next(node.id, option.id);
                    break;
                }
                attempts += 1;
                if (attempts >= (data.maxAttempts || 3)) {
                    attempts = 0;
                    const fallback = next(node.id, 'invalid');
                    if (fallback) {
                        node = fallback;
                        break;
                    }
                    effects.push({ type: 'handoff', reason: 'invalid-option' });
                    return finish();
                }
                replies.push(
                    render(data.invalidText || 'Opção inválida. Responda com o número de uma das opções.', vars)
                );
                replies.push(render(menuText(data), vars));
                return wait();
            }

            case 'question': {
                if (answer === null) {
                    replies.push(render(data.text, vars));
                    return wait();
                }
                const valid = (VALIDATORS[data.validation] || VALIDATORS.any)(answer);
                if (!valid) {
                    replies.push(render(data.invalidText || 'Não entendi. Pode responder de novo?', vars));
                    return wait();
                }
                if (data.variable) vars[data.variable] = answer.trim();
                answer = null;
                node = next(node.id);
                break;
            }

            case 'condition': {
                const rule = (data.rules || []).find(item => evaluate(item, vars, input));
                node = next(node.id, rule ? rule.id : 'else');
                break;
            }

            case 'businessHours':
                node = next(node.id, isOpen(data, now) ? 'open' : 'closed');
                break;

            case 'delay':
                await env.sleep(Math.min(Number(data.seconds) || 1, MAX_DELAY_SECONDS) * 1000);
                node = next(node.id);
                break;

            case 'http': {
                let handle = 'success';
                try {
                    const result = await httpCall(data, vars, env);
                    if (data.saveAs) vars[data.saveAs] = result.body;
                    if (!result.ok) handle = 'error';
                } catch (error) {
                    if (data.saveAs) vars[data.saveAs] = { error: error.message };
                    handle = 'error';
                }
                node = next(node.id, handle);
                break;
            }

            case 'tag':
                if (data.tag) effects.push({ type: 'tag', tag: render(data.tag, vars).trim() });
                node = next(node.id);
                break;

            case 'handoff':
                if (data.text) replies.push(render(data.text, vars));
                effects.push({ type: 'handoff', reason: 'flow' });
                return finish();

            case 'end':
                if (data.text) replies.push(render(data.text, vars));
                effects.push({ type: 'end', close: Boolean(data.close) });
                return finish();

            default:
                node = next(node.id);
        }
    }
    if (node) {
        // passou de MAX_STEPS sem esperar resposta: provável laço no fluxo
        effects.push({ type: 'handoff', reason: 'loop' });
    }
    return finish();
}

// ---------- validação (publicar) ----------

const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Problemas que impedem publicar (errors) e avisos (warnings). Cada item: { nodeId?, message }. */
function validate(definition) {
    const errors = [];
    const warnings = [];
    const nodes = definition.nodes || [];
    const edges = definition.edges || [];
    const byId = new Map(nodes.map(node => [node.id, node]));
    const starts = nodes.filter(node => node.type === 'start');
    if (starts.length !== 1) errors.push({ message: 'O fluxo precisa de exatamente um bloco de início.' });

    for (const edge of edges) {
        if (!byId.has(edge.source) || !byId.has(edge.target))
            errors.push({ message: 'Há uma ligação para um bloco que não existe.' });
    }

    for (const node of nodes) {
        const data = node.data || {};
        const err = message => errors.push({ nodeId: node.id, message });
        if (!NODE_TYPES.includes(node.type)) err('Tipo de bloco desconhecido: ' + node.type);
        if (node.type === 'message' && !String(data.text || '').trim()) err('Mensagem sem texto.');
        if (node.type === 'menu') {
            if (!String(data.text || '').trim()) err('Menu sem pergunta.');
            if (!(data.options || []).length) err('Menu sem opções.');
            if ((data.options || []).length > 10) err('Menu com mais de 10 opções.');
            if ((data.options || []).some(option => !String(option.label || '').trim()))
                err('Opção de menu sem texto.');
        }
        if (node.type === 'question') {
            if (!String(data.text || '').trim()) err('Pergunta sem texto.');
            if (!VARIABLE.test(data.variable || '')) err('Pergunta sem nome de variável válido (ex.: nome_cliente).');
        }
        if (node.type === 'condition' && !(data.rules || []).length) err('Condição sem regras.');
        if (node.type === 'businessHours' && !(data.schedule || []).length) err('Horário de atendimento sem horários.');
        if (node.type === 'http' && !/^https?:\/\//i.test(data.url || '')) err('Requisição sem URL http(s).');
        if (node.type === 'tag' && !String(data.tag || '').trim()) err('Etiqueta sem nome.');
        if (node.type === 'question' || node.type === 'http') {
            if (data.saveAs !== undefined && data.saveAs !== '' && !VARIABLE.test(data.saveAs))
                err('Nome de variável inválido.');
        }
    }

    // alcance a partir do início
    if (starts.length === 1) {
        const seen = new Set();
        const queue = [starts[0].id];
        while (queue.length) {
            const id = queue.shift();
            if (seen.has(id)) continue;
            seen.add(id);
            edges.filter(edge => edge.source === id).forEach(edge => queue.push(edge.target));
        }
        for (const node of nodes) {
            if (!seen.has(node.id))
                warnings.push({ nodeId: node.id, message: 'Bloco não é alcançado a partir do início.' });
        }
        if (!edges.some(edge => edge.source === starts[0].id))
            errors.push({ nodeId: starts[0].id, message: 'O início não está ligado a nenhum bloco.' });
    }
    return { errors, warnings };
}

module.exports = { run, validate, normalize, render, menuText, matchOption, isOpen, NODE_TYPES };
