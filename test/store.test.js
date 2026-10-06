import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import Sessions from '../server/sessions.js';
import store from '../server/store.js';
import { db, disconnect } from '../server/db.js';

// não abre navegador: launch() só é chamado, não executado
const launch = vi.spyOn(Sessions, 'launch').mockImplementation(() => undefined);

afterAll(() => disconnect());

beforeEach(async () => {
    Sessions.sessions = [];
    launch.mockClear();
    await db().session.deleteMany();
});

describe('persistência de sessões', () => {
    it('/start grava a sessão com autoStart', async () => {
        await Sessions.start('p1');
        const row = await db().session.findUnique({ where: { name: 'p1' } });
        expect(row).toMatchObject({ name: 'p1', engine: 'WPPCONNECT', autoStart: true });
    });

    it('/close desliga o autoStart; shutdown mantém', async () => {
        await Sessions.start('p1');
        await Sessions.start('p2');
        await Sessions.closeSession('p1', { shutdown: true });
        await Sessions.closeSession('p2');
        expect(await store.listAutoStart()).toEqual(['p1']);
        expect((await db().session.findUnique({ where: { name: 'p2' } })).lastState).toBe('CLOSED');
    });

    it('/start de novo reativa o autoStart', async () => {
        await Sessions.start('p1');
        await Sessions.closeSession('p1');
        await Sessions.start('p1');
        expect(await store.listAutoStart()).toEqual(['p1']);
    });

    it('restore() inicia as sessões marcadas, em ordem', async () => {
        await store.saveSession('a');
        await store.saveSession('b');
        await store.setAutoStart('b', false);
        await store.saveSession('c');
        vi.useFakeTimers();
        const restoring = Sessions.restore();
        await vi.runAllTimersAsync();
        expect(await restoring).toEqual(['a', 'c']);
        vi.useRealTimers();
        expect(Sessions.getSessions().map(session => session.name)).toEqual(['a', 'c']);
        expect(launch).toHaveBeenCalledTimes(2);
    });
});

describe('webhook legado', () => {
    it('persiste, substitui e remove o hook da sessão', async () => {
        await Sessions.start('h1');
        await Sessions.saveHook('h1', 'https://a.example/hook');
        await Sessions.saveHook('h1', 'https://b.example/hook');
        expect(await store.getLegacyHook('h1')).toBe('https://b.example/hook');
        expect(await db().webhook.count({ where: { legacy: true } })).toBe(1);

        await Sessions.saveHook('h1', '');
        expect(await store.getLegacyHook('h1')).toBeNull();
    });

    it('sessão recriada (após restart) recupera o hook', async () => {
        await Sessions.start('h1');
        await Sessions.saveHook('h1', 'https://a.example/hook');
        Sessions.sessions = []; // simula restart do processo
        const session = await Sessions.start('h1');
        expect(session.hook).toBe('https://a.example/hook');
    });

    it('falha no banco não derruba a operação', async () => {
        const spy = vi.spyOn(db().session, 'upsert').mockRejectedValueOnce(new Error('disk I/O error'));
        const session = await Sessions.start('x1');
        expect(session.state).toBe('STARTING');
        spy.mockRestore();
    });
});
