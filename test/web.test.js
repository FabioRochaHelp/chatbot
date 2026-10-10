import { describe, it, expect, beforeAll, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import request from 'supertest';
import { resetAll, createApp, Sessions, history, db, disconnect, incoming } from './helpers.js';

const webDir = fs.mkdtempSync(path.join(os.tmpdir(), 'conectzap-web-'));
fs.mkdirSync(path.join(webDir, 'assets'));
fs.writeFileSync(path.join(webDir, 'index.html'), '<!doctype html><title>ConectZap</title>');
fs.writeFileSync(path.join(webDir, 'assets', 'app-123.js'), 'console.log(1)');
fs.writeFileSync(path.join(webDir, 'favicon.svg'), '<svg/>');

const app = createApp({ sessions: Sessions, webDir });
const html = url => request(app).get(url).set('Accept', 'text/html,application/xhtml+xml');

afterAll(async () => {
    fs.rmSync(webDir, { recursive: true, force: true });
    await disconnect();
});

describe('painel (web/dist)', () => {
    beforeAll(resetAll);

    it('GET / devolve JSON para API/healthcheck e o painel para o navegador', async () => {
        expect((await request(app).get('/')).body).toEqual({ result: 'ok' });
        const page = await html('/');
        expect(page.headers['content-type']).toMatch(/html/);
        expect(page.text).toContain('<title>ConectZap</title>');
        expect((await request(app).get('/health')).body).toEqual({ result: 'ok' });
    });

    it('rotas do painel caem no index.html; rotas antigas não', async () => {
        for (const url of ['/login', '/sessions', '/sessions/loja', '/send']) {
            expect((await html(url)).text).toContain('<title>ConectZap</title>');
        }
        const legacy = await html('/status?sessionName=x');
        expect(legacy.headers['content-type']).toMatch(/json/);
        expect((await html('/sendText')).headers['content-type']).toMatch(/json/);
    });

    it('assets com cache longo; arquivo inexistente é 404', async () => {
        const asset = await request(app).get('/assets/app-123.js');
        expect(asset.status).toBe(200);
        expect(asset.headers['cache-control']).toContain('immutable');
        expect((await request(app).get('/assets/nada.js')).status).toBe(404);
        expect((await request(app).get('/favicon.svg')).status).toBe(200);
    });

    it('sem build, GET / continua JSON', async () => {
        const bare = createApp({ sessions: Sessions, webDir: path.join(webDir, 'nao-existe') });
        expect((await request(bare).get('/').set('Accept', 'text/html')).body).toEqual({ result: 'ok' });
    });
});

describe('GET /api/v1/stats', () => {
    beforeEach(resetAll);

    it('conta conversas, não lidas e mensagens por dia no fuso do cliente', async () => {
        const now = Math.floor(Date.now() / 1000);
        await history.recordIncoming('s1', incoming({ t: now }));
        await history.recordIncoming('s1', incoming({ t: now }));
        await history.recordIncoming('s1', incoming({ t: now - 2 * 86400, from: '5511922222222@c.us' }));
        await history.recordIncoming('s1', incoming({ fromMe: true, to: '5511922222222@c.us', from: 'x', t: now }));
        await db().conversation.updateMany({
            where: { contact: { waId: '5511922222222@c.us' } },
            data: { status: 'pending' }
        });
        Sessions.sessions = [{ name: 's1', state: 'CONNECTED' }];

        const res = await request(app).get('/api/v1/stats?tzOffset=180');
        expect(res.status).toBe(200);
        const stats = res.body.data;
        expect(stats.sessions).toEqual({ total: 1, connected: 1 });
        expect(stats.conversations).toEqual({ bot: 0, pending: 2, open: 0 });
        expect(stats.unread).toBe(3);
        expect(stats.messagesToday).toEqual({ in: 2, out: 1 });
        expect(stats.messagesByDay).toHaveLength(7);
        expect(stats.messagesByDay[4]).toMatchObject({ in: 1, out: 0 });
        const localToday = new Date(Date.now() - 180 * 60000).toISOString().slice(0, 10);
        expect(stats.messagesByDay[6].date).toBe(localToday);
        Sessions.sessions = [];
    });
});
