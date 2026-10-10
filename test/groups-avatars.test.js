import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import fs from 'fs';
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
    server
} from './helpers.js';

const avatars = server('../server/avatars.js');
const pipeline = server('../server/pipeline/index.js');

afterAll(() => disconnect());
beforeEach(resetAll);

const groupMessage = (fields = {}) =>
    incoming({
        from: '120363000000000001@g.us',
        isGroupMsg: true,
        author: '5511911111111@c.us',
        body: 'oi grupo',
        ...fields
    });

describe('grupos', () => {
    it('por padrão mensagens de grupo e de canais são ignoradas', async () => {
        await db().session.create({ data: { name: 's1', engine: 'WPPCONNECT' } });
        expect(await history.recordIncoming('s1', groupMessage())).toBeNull();
        expect(await history.recordIncoming('s1', incoming({ from: '120363999@newsletter' }))).toBeNull();
        expect(
            await history.recordOutgoing('s1', '120363000000000001@g.us', { type: 'chat', body: 'x' }, { id: 'o1' })
        ).toBeNull();
        expect(await db().conversation.count()).toBe(0);
        // conversa individual continua normal
        expect(await history.recordIncoming('s1', incoming())).not.toBeNull();
    });

    it('com grupos aceitos: entram na fila e o bot nunca responde, mesmo ligado', async () => {
        const definition = {
            nodes: [
                { id: 's', type: 'start', position: { x: 0, y: 0 }, data: {} },
                { id: 'm', type: 'message', position: { x: 0, y: 0 }, data: { text: 'Olá!' } }
            ],
            edges: [{ id: '1', source: 's', target: 'm' }],
            settings: {}
        };
        const flow = await db().flow.create({ data: { name: 'F', definition, published: definition, version: 1 } });
        await db().session.create({
            data: { name: 's1', engine: 'WPPCONNECT', botMode: 'flow', flowId: flow.id, acceptGroups: true }
        });
        const client = connect('s1');

        const saved = await history.recordIncoming('s1', groupMessage());
        await pipeline.handle(Sessions, 's1', saved);
        const conversation = await db().conversation.findFirst({ include: { contact: true } });
        expect(conversation).toMatchObject({ status: 'pending', contact: { isGroup: true } });
        expect(client.sendText).not.toHaveBeenCalled();

        // conversa individual na mesma sessão continua com o bot
        await pipeline.handle(Sessions, 's1', await history.recordIncoming('s1', incoming()));
        expect(client.sendText).toHaveBeenCalledWith('556334140378@c.us', 'Olá!');
    });

    it('nome de quem escreveu fica na mensagem, não no contato do grupo; nome do grupo vem do WhatsApp', async () => {
        await db().session.create({ data: { name: 's1', engine: 'WPPCONNECT', acceptGroups: true } });
        const first = await history.recordIncoming('s1', groupMessage({ sender: { pushname: 'Ana' } }));
        await history.recordIncoming('s1', groupMessage({ sender: { pushname: 'Bruno' } }));
        expect(first.payload).toEqual({ authorName: 'Ana' });
        let group = await db().contact.findFirst({ where: { isGroup: true } });
        expect(group.pushName).toBeNull();

        const client = fakeClient({
            getProfilePicFromServer: async () => ({}),
            getChatById: async () => ({ name: 'Equipe Vendas' })
        });
        group = (await avatars.refresh('s1', group, client)).contact;
        expect(group.pushName).toBe('Equipe Vendas');
    });

    it('desligar grupos na sessão encerra as conversas de grupo abertas', async () => {
        vi.spyOn(Sessions, 'launch').mockImplementation(() => undefined);
        const app = createApp({ sessions: Sessions });
        const admin = request.agent(app);
        await admin.post('/api/v1/auth/setup').send({ email: 'a@x.com', name: 'A', password: 'senha-forte-1' });
        await admin.post('/api/v1/sessions').send({ name: 's1' });
        const on = await admin.patch('/api/v1/sessions/s1').send({ acceptGroups: true });
        expect(on.body.data.acceptGroups).toBe(true);
        await history.recordIncoming('s1', groupMessage());
        await history.recordIncoming('s1', incoming());

        await admin.patch('/api/v1/sessions/s1').send({ acceptGroups: false });
        const conversations = await db().conversation.findMany({ include: { contact: true } });
        expect(conversations.find(item => item.contact.isGroup).status).toBe('closed');
        expect(conversations.find(item => !item.contact.isGroup).status).toBe('pending');
    });
});

describe('foto do contato', () => {
    const PNG = Buffer.from('foto-de-perfil');
    const fetchOk = vi.fn(async () => ({ ok: true, status: 200, arrayBuffer: async () => PNG }));
    afterEach(() => vi.unstubAllGlobals());

    async function contactWith(clientOverrides) {
        await db().session.create({ data: { name: 's1', engine: 'WPPCONNECT' } });
        const client = connect('s1', fakeClient(clientOverrides));
        const saved = await history.recordIncoming('s1', incoming(), null);
        const contact = await db().contact.findFirst({
            where: { conversations: { some: { id: saved.conversationId } } }
        });
        return { client, contact };
    }

    it('baixa, guarda e serve a foto; some quando o contato a esconde', async () => {
        const getProfilePicFromServer = vi.fn(async () => ({ imgFull: 'https://pps.whatsapp.net/foto.jpg' }));
        const { client, contact } = await contactWith({ getProfilePicFromServer });
        const { contact: updated } = await avatars.refresh('s1', contact, client, { fetch: fetchOk });
        expect(getProfilePicFromServer).toHaveBeenCalledWith('556334140378@c.us');
        expect(updated.avatarPath).toMatch(/^avatars\/s1\/\d+\.jpg$/);
        expect(updated.avatarCheckedAt).not.toBeNull();

        const app = createApp({ sessions: Sessions });
        const res = await request(app).get(`/api/v1/contacts/${contact.id}/avatar`);
        expect(res.status).toBe(200);
        expect(res.headers['cache-control']).toContain('max-age=86400');
        expect(res.body.toString()).toBe('foto-de-perfil');

        client.getProfilePicFromServer = vi.fn(async () => ({}));
        const { contact: hidden } = await avatars.refresh('s1', updated, client, { fetch: fetchOk });
        expect(hidden.avatarPath).toBeNull();
        expect((await request(app).get(`/api/v1/contacts/${contact.id}/avatar`)).status).toBe(404);
    });

    it('falha no download devolve o motivo e tenta de novo em 1 hora (não em 24)', async () => {
        const { client, contact } = await contactWith({
            getProfilePicFromServer: async () => ({ imgFull: 'https://x/y.jpg' })
        });
        const failing = vi.fn(async () => ({ ok: false, status: 403 }));
        const result = await avatars.refresh('s1', contact, client, { fetch: failing });
        expect(result.error).toBe('download da foto: HTTP 403');
        const after = await db().contact.findUnique({ where: { id: contact.id } });
        expect(after.avatarPath).toBeNull();
        // agora não insiste...
        expect(avatars.isStale(after)).toBe(false);
        // ...mas daqui a pouco mais de 1 hora, sim
        const inOneHour = new Date(after.avatarCheckedAt.getTime() - avatars.RETRY_MS - 1000);
        expect(avatars.isStale({ avatarCheckedAt: inOneHour })).toBe(true);
    });

    it('erro ao consultar o WhatsApp não é tratado como "sem foto"', async () => {
        const { client, contact } = await contactWith({
            getProfilePicFromServer: async () => {
                throw new Error('Execution context was destroyed');
            }
        });
        await db().contact.update({ where: { id: contact.id }, data: { avatarPath: 'avatars/s1/antiga.jpg' } });
        const result = await avatars.refresh('s1', { ...contact, avatarPath: 'avatars/s1/antiga.jpg' }, client, {
            fetch: fetchOk
        });
        expect(result.error).toMatch(/Execution context/);
        // a foto que já existia continua
        expect((await db().contact.findUnique({ where: { id: contact.id } })).avatarPath).toBe('avatars/s1/antiga.jpg');
    });

    it('busca em lote: contatos com conversa recente, sem repetir os já consultados', async () => {
        await db().session.create({ data: { name: 's1', engine: 'WPPCONNECT' } });
        for (const number of ['5511900000001', '5511900000002', '5511900000003']) {
            await history.recordIncoming('s1', incoming({ from: number + '@c.us' }), null);
        }
        await db().contact.updateMany({ where: { waId: '5511900000003@c.us' }, data: { avatarCheckedAt: new Date() } });
        vi.stubGlobal('fetch', fetchOk);
        const getProfilePicFromServer = vi.fn(async () => ({ imgFull: 'https://pps.whatsapp.net/f.jpg' }));
        const client = fakeClient({ getProfilePicFromServer });

        expect(await avatars.sweep('s1', client, { gapMs: 0 })).toBe(2);
        await vi.waitFor(async () =>
            expect(await db().contact.count({ where: { avatarPath: { not: null } } })).toBe(2)
        );
        expect(getProfilePicFromServer).toHaveBeenCalledTimes(2);
        // force: consulta todos de novo
        await avatars.idle();
        expect(await avatars.sweep('s1', client, { force: true, gapMs: 0 })).toBe(3);
        await avatars.idle();
    });

    it('rotas: atualizar foto do contato devolve o motivo; buscar fotos da sessão', async () => {
        vi.spyOn(Sessions, 'launch').mockImplementation(() => undefined);
        const app = createApp({ sessions: Sessions });
        const admin = request.agent(app);
        await admin.post('/api/v1/auth/setup').send({ email: 'a@x.com', name: 'A', password: 'senha-forte-1' });
        const { contact } = await contactWith({
            getProfilePicFromServer: async () => ({ imgFull: 'https://x/y.jpg' })
        });
        vi.stubGlobal(
            'fetch',
            vi.fn(async () => ({ ok: false, status: 404 }))
        );
        const failed = await admin.post(`/api/v1/contacts/${contact.id}/avatar/refresh`);
        expect(failed.status).toBe(502);
        expect(failed.body.error.message).toBe('não foi possível buscar a foto: download da foto: HTTP 404');

        vi.stubGlobal('fetch', fetchOk);
        const ok = await admin.post(`/api/v1/contacts/${contact.id}/avatar/refresh`);
        expect(ok.body.data.avatarPath).not.toBeNull();
        const swept = await admin.post('/api/v1/sessions/s1/avatars/refresh');
        expect(swept.body.data).toEqual({ queued: 1 });
    });

    it('mensagem recebida busca a foto em segundo plano, no máximo uma vez por dia', async () => {
        vi.stubGlobal('fetch', fetchOk);
        const getProfilePicFromServer = vi.fn(async () => ({ imgFull: 'https://pps.whatsapp.net/f.jpg' }));
        await db().session.create({ data: { name: 's1', engine: 'WPPCONNECT' } });
        const client = fakeClient({ getProfilePicFromServer });
        await history.recordIncoming('s1', incoming(), client);
        await vi.waitFor(async () => expect((await db().contact.findFirst()).avatarPath).not.toBeNull());
        const contact = await db().contact.findFirst();
        expect(fs.existsSync(history.mediaAbsolutePath(contact.avatarPath))).toBe(true);

        await history.recordIncoming('s1', incoming({ body: 'de novo' }), client);
        await new Promise(resolve => setTimeout(resolve, 50));
        expect(getProfilePicFromServer).toHaveBeenCalledTimes(1);
        expect(avatars.isStale({ avatarCheckedAt: new Date(Date.now() - avatars.REFRESH_MS - 1000) })).toBe(true);
    });
});
