import { vi } from 'vitest';
import { createRequire } from 'module';

// o código do servidor é CommonJS e usa require() internamente; importar por ESM no teste
// criaria uma segunda instância dos módulos (caches e EventEmitter separados)
export const server = createRequire(import.meta.url);
export const Sessions = server('../server/sessions.js');
export const history = server('../server/history.js');
export const events = server('../server/events.js');
export const { db, disconnect } = server('../server/db.js');
export const { createApp } = server('../server/app.js');
export const config = server('../server/config.js');
export const auth = server('../server/auth.js');

/** Zera o banco e as sessões em memória. */
export async function resetAll() {
    Sessions.sessions = [];
    history._sessionIds.clear();
    await db().session.deleteMany();
    await db().flow.deleteMany();
    await db().aiUsage.deleteMany();
    await db().aiAgent.deleteMany();
    await db().apiKey.deleteMany();
    await db().user.deleteMany();
    auth.refreshAuthState();
}

/** Define API_TOKEN durante o bloco de testes (a autenticação lê a config real). */
export function useApiToken(hooks, token) {
    let previous;
    hooks.beforeAll(() => {
        previous = config.apiToken;
        config.apiToken = token;
    });
    hooks.afterAll(() => {
        config.apiToken = previous;
    });
}

let nextId = 1;

/** Client falso do wppconnect: cada envio devolve um id novo. */
export function fakeClient(overrides = {}) {
    const sent = () => ({ id: 'true_x_' + nextId++ });
    return {
        sendText: vi.fn(async () => sent()),
        sendFile: vi.fn(async () => sent()),
        sendPttFromBase64: vi.fn(async () => sent()),
        sendLocation: vi.fn(async () => sent()),
        sendLinkPreview: vi.fn(async () => sent()),
        sendContactVcard: vi.fn(async () => sent()),
        checkNumberStatus: vi.fn(async id => ({ id, numberExists: true })),
        decryptFile: vi.fn(async () => Buffer.from('media-bytes')),
        ...overrides
    };
}

/** Coloca uma sessão CONNECTED em memória (sem navegador). */
export function connect(name, client = fakeClient()) {
    Sessions.sessions = Sessions.sessions || [];
    Sessions.sessions.push({ name, state: 'CONNECTED', client: Promise.resolve(client), status: 'isLogged' });
    return client;
}

/** Mensagem recebida no formato do wppconnect. */
export function incoming(fields = {}) {
    const id = fields.id || 'false_556334140378@c.us_' + nextId++;
    return {
        id,
        from: '556334140378@c.us',
        to: '5511900000000@c.us',
        fromMe: false,
        type: 'chat',
        body: 'Olá!',
        t: 1791300000,
        sender: { pushname: 'Maria' },
        isGroupMsg: false,
        ...fields
    };
}
