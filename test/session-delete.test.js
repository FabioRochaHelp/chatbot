import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import fs from 'fs';
import path from 'path';
import request from 'supertest';
import {
    resetAll,
    createApp,
    Sessions,
    history,
    db,
    disconnect,
    connect,
    fakeClient,
    incoming,
    config
} from './helpers.js';

const app = createApp({ sessions: Sessions });
vi.spyOn(Sessions, 'launch').mockImplementation(() => undefined);
afterAll(() => disconnect());

let admin;
beforeEach(async () => {
    await resetAll();
    admin = request.agent(app);
    await admin.post('/api/v1/auth/setup').send({ email: 'a@x.com', name: 'Admin', password: 'senha-forte-1' });
});

/** Sessão com conversa, mídia, foto, webhook e login do WhatsApp em disco. */
async function seedSession(name) {
    await db().session.create({ data: { name, engine: 'WPPCONNECT' } });
    const client = connect(name, fakeClient({ logout: vi.fn(async () => true), close: vi.fn(async () => undefined) }));
    const saved = await history.recordIncoming(
        name,
        incoming({ type: 'image', mimetype: 'image/jpeg', id: 'img-' + name }),
        client
    );
    const contact = await db().contact.findFirst({ where: { session: { name } } });
    const avatarPath = path.join('avatars', name, contact.id + '.jpg');
    fs.mkdirSync(path.join(config.mediaDir, 'avatars', name), { recursive: true });
    fs.writeFileSync(path.join(config.mediaDir, avatarPath), 'foto');
    await db().contact.update({ where: { id: contact.id }, data: { avatarPath } });
    await db().webhook.create({
        data: { url: 'https://x.com/' + name, sessionId: contact.sessionId, events: ['message.received'] }
    });
    fs.mkdirSync(path.join(config.tokensDir, name, 'Default'), { recursive: true });
    fs.writeFileSync(path.join(config.tokensDir, name, 'Default', 'Cookies'), 'login');
    fs.writeFileSync(path.join(config.tokensDir, name + '.data.json'), '{}');
    return {
        client,
        mediaFile: history.mediaAbsolutePath(saved.mediaPath),
        avatarFile: path.join(config.mediaDir, avatarPath)
    };
}

describe('excluir sessão', () => {
    it('desconecta o aparelho, fecha o navegador e apaga dados e arquivos só da sessão', async () => {
        const loja = await seedSession('loja');
        const outra = await seedSession('outra');
        const flow = await db().flow.create({ data: { name: 'F', definition: {} } });
        const agent = await db().aiAgent.create({ data: { name: 'IA' } });

        const res = await admin.delete('/api/v1/sessions/loja');
        expect(res.status).toBe(200);
        expect(res.body.data).toMatchObject({
            deleted: true,
            loggedOut: true,
            conversations: 1,
            messages: 1,
            files: 2
        });
        expect(loja.client.logout).toHaveBeenCalled();
        expect(loja.client.close).toHaveBeenCalled();
        expect(Sessions.getSession('loja')).toBe(false);

        expect(await db().session.findUnique({ where: { name: 'loja' } })).toBeNull();
        expect(await db().contact.count({ where: { session: { name: 'loja' } } })).toBe(0);
        expect(await db().webhook.count({ where: { url: 'https://x.com/loja' } })).toBe(0);
        expect(fs.existsSync(loja.mediaFile)).toBe(false);
        expect(fs.existsSync(loja.avatarFile)).toBe(false);
        expect(fs.existsSync(path.join(config.tokensDir, 'loja'))).toBe(false);
        expect(fs.existsSync(path.join(config.tokensDir, 'loja.data.json'))).toBe(false);

        // a outra sessão, fluxos e assistentes continuam
        expect(fs.existsSync(outra.mediaFile)).toBe(true);
        expect(fs.existsSync(outra.avatarFile)).toBe(true);
        expect(fs.existsSync(path.join(config.tokensDir, 'outra'))).toBe(true);
        expect(await db().contact.count({ where: { session: { name: 'outra' } } })).toBe(1);
        expect(await db().flow.findUnique({ where: { id: flow.id } })).not.toBeNull();
        expect(await db().aiAgent.findUnique({ where: { id: agent.id } })).not.toBeNull();
    });

    it('sessão chamada "avatars" não apaga as fotos das outras', async () => {
        const outra = await seedSession('outra');
        await seedSession('avatars');
        await admin.delete('/api/v1/sessions/avatars');
        expect(fs.existsSync(outra.avatarFile)).toBe(true);
    });

    it('sessão desconectada: exclui sem logout; dá para recriar com o mesmo nome', async () => {
        await seedSession('loja');
        Sessions.getSession('loja').state = 'QRCODE';
        const res = await admin.delete('/api/v1/sessions/loja');
        expect(res.body.data.loggedOut).toBe(false);

        // novo registro com o mesmo nome: o id em cache da sessão antiga não pode ser reaproveitado
        await db().session.create({ data: { name: 'loja', engine: 'WPPCONNECT' } });
        expect(await history.recordIncoming('loja', incoming({ id: 'nova' }))).not.toBeNull();
    });

    it('logout que falha não impede a exclusão', async () => {
        const { client } = await seedSession('loja');
        client.logout.mockRejectedValue(new Error('page closed'));
        const res = await admin.delete('/api/v1/sessions/loja');
        expect(res.body.data).toMatchObject({ deleted: true, loggedOut: false });
        expect(await db().session.count()).toBe(0);
    });

    it('404 para sessão inexistente; atendente não exclui', async () => {
        expect((await admin.delete('/api/v1/sessions/nada')).status).toBe(404);
        await seedSession('loja');
        await admin.post('/api/v1/users').send({ email: 'b@x.com', name: 'B', password: 'senha-b-123', role: 'agent' });
        const agent = request.agent(app);
        await agent.post('/api/v1/auth/login').send({ email: 'b@x.com', password: 'senha-b-123' });
        expect((await agent.delete('/api/v1/sessions/loja')).status).toBe(403);
        expect(await db().session.count()).toBe(1);
    });
});
