import { describe, it, expect, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../server/app.js';

const baseConfig = { apiToken: null, corsOrigins: [], rateLimit: 0, trustProxy: false };
const PNG = 'data:image/png;base64,' + Buffer.from('fake-png').toString('base64');

function fakeSessions() {
    const sessions = {};
    return {
        sessions,
        start: vi.fn(async name => (sessions[name] = sessions[name] || { name, state: 'STARTING' })),
        getStatus: vi.fn(async name => sessions[name] || false),
        getSession: vi.fn(name => sessions[name] || false),
        saveHook: vi.fn(async () => ({ result: 'success', message: 'Hook Atualizado' })),
        sendText: vi.fn(async () => ({ result: 'success' })),
        sendFile: vi.fn(async () => ({ result: 'success' })),
        sendLocation: vi.fn(async () => ({ result: 'success' })),
        checkNumberStatus: vi.fn(async () => ({ result: { numberExists: true } })),
        clearCloudToken: vi.fn(async () => undefined),
        closeSession: vi.fn(async () => ({ result: 'success', message: 'CLOSED' }))
    };
}

describe('rotas legadas', () => {
    let sessions;
    let app;

    beforeEach(() => {
        sessions = fakeSessions();
        app = createApp({ config: baseConfig, sessions });
    });

    it('GET / responde ok sem autenticação', async () => {
        const res = await request(app).get('/');
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ result: 'ok' });
    });

    it('GET /start inicia a sessão', async () => {
        const res = await request(app).get('/start?sessionName=session1');
        expect(res.body).toEqual({ result: 'success', message: 'STARTING' });
        expect(sessions.start).toHaveBeenCalledWith('session1');
    });

    it('GET /status retorna NOT_FOUND para sessão inexistente', async () => {
        const res = await request(app).get('/status?sessionName=nada');
        expect(res.body).toEqual({ result: 'NOT_FOUND' });
    });

    it('rejeita sessionName ausente ou com path traversal', async () => {
        for (const url of ['/start', '/start?sessionName=../etc', '/start?sessionName=a/b']) {
            const res = await request(app).get(url);
            expect(res.status).toBe(400);
            expect(res.body.result).toBe('error');
            expect(res.body.message).toBe('INVALID_PARAMS');
        }
        expect(sessions.start).not.toHaveBeenCalled();
    });

    it('GET /qrcode em JSON e em PNG', async () => {
        sessions.sessions.s1 = { name: 's1', state: 'QRCODE', qrcode: PNG };
        const json = await request(app).get('/qrcode?sessionName=s1');
        expect(json.body).toEqual({ result: 'success', message: 'QRCODE', qrcode: PNG });

        const png = await request(app).get('/qrcode?sessionName=s1&image=true');
        expect(png.headers['content-type']).toBe('image/png');
        expect(png.headers['cross-origin-resource-policy']).toBe('cross-origin');
        expect(png.body.toString()).toBe('fake-png');
    });

    it('GET /qrcode sem sessão retorna NOTFOUND', async () => {
        const res = await request(app).get('/qrcode?sessionName=s1');
        expect(res.body).toEqual({ result: 'error', message: 'NOTFOUND' });
    });

    it('POST /sendText normaliza o número', async () => {
        const res = await request(app)
            .post('/sendText')
            .send({ sessionName: 'session1', number: '+55 63 3414-0378', text: 'Hello\nWorld' });
        expect(res.body).toEqual({ result: 'success' });
        expect(sessions.sendText).toHaveBeenCalledWith('session1', '556334140378@c.us', 'Hello\nWorld');
    });

    it('POST /sendText rejeita número inválido', async () => {
        const res = await request(app).post('/sendText').send({ sessionName: 's1', number: 'x', text: 'oi' });
        expect(res.status).toBe(400);
        expect(res.body.errors[0].field).toBe('number');
        expect(sessions.sendText).not.toHaveBeenCalled();
    });

    it('POST /sendFile repassa os parâmetros', async () => {
        await request(app)
            .post('/sendFile')
            .send({ sessionName: 's1', number: 556334140378, base64Data: '44696d61', fileName: 'test.txt' });
        expect(sessions.sendFile).toHaveBeenCalledWith('s1', '556334140378@c.us', '44696d61', 'test.txt', undefined);
    });

    it('POST /sendLocation aceita lat/long numéricos', async () => {
        await request(app)
            .post('/sendLocation')
            .send({ sessionName: 's1', number: '556334140378', lat: -10.18, long: -48.33, local: 'Palmas' });
        expect(sessions.sendLocation).toHaveBeenCalledWith('s1', '556334140378@c.us', -10.18, -48.33, 'Palmas');
    });

    it('POST /sendHook aceita URL e rejeita lixo', async () => {
        const ok = await request(app).post('/sendHook').send({ sessionName: 's1', hook: 'https://example.com/hook' });
        expect(ok.body.result).toBe('success');
        const bad = await request(app).post('/sendHook').send({ sessionName: 's1', hook: 'not a url' });
        expect(bad.status).toBe(400);
    });

    it('GET /checkNumberStatus aceita parâmetros no body (clientes antigos)', async () => {
        const res = await request(app).get('/checkNumberStatus').send({ sessionName: 's1', number: '556334140378' });
        expect(res.body).toEqual({ result: { numberExists: true } });
        expect(sessions.checkNumberStatus).toHaveBeenCalledWith('s1', '556334140378@c.us');
    });

    it('GET /close limpa o token e fecha', async () => {
        const res = await request(app).get('/close?sessionName=s1');
        expect(res.body).toEqual({ result: 'success', message: 'CLOSED' });
        expect(sessions.clearCloudToken).toHaveBeenCalled();
    });

    it('JSON inválido retorna 400 e erro do handler retorna 500', async () => {
        const bad = await request(app).post('/sendText').set('Content-Type', 'application/json').send('{oops');
        expect(bad.status).toBe(400);
        expect(bad.body).toEqual({ result: 'error', message: 'INVALID_JSON' });

        sessions.sendText.mockRejectedValueOnce(new Error('boom'));
        const fail = await request(app)
            .post('/sendText')
            .send({ sessionName: 's1', number: '556334140378', text: 'oi' });
        expect(fail.status).toBe(500);
        expect(fail.body).toEqual({ result: 'error', message: 'boom' });
    });

    it('rota inexistente retorna 404', async () => {
        const res = await request(app).get('/exec');
        expect(res.status).toBe(404);
    });
});

describe('autenticação', () => {
    const app = createApp({ config: { ...baseConfig, apiToken: 'segredo' }, sessions: fakeSessions() });

    it('bloqueia sem token, mas libera GET /', async () => {
        expect((await request(app).get('/status?sessionName=s1')).status).toBe(401);
        expect((await request(app).get('/')).status).toBe(200);
    });

    it('aceita Bearer e ?token= (compat)', async () => {
        const bearer = await request(app).get('/status?sessionName=s1').set('Authorization', 'Bearer segredo');
        expect(bearer.status).toBe(200);
        const query = await request(app).get('/status?sessionName=s1&token=segredo');
        expect(query.status).toBe(200);
    });

    it('rejeita token errado', async () => {
        const res = await request(app).get('/status?sessionName=s1').set('Authorization', 'Bearer errado');
        expect(res.status).toBe(401);
        expect(res.body).toEqual({ result: 'error', message: 'UNAUTHORIZED' });
    });
});
