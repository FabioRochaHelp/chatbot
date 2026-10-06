import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import fs from 'fs';
import { resetAll, fakeClient, incoming, history, events, db, disconnect } from './helpers.js';

afterAll(() => disconnect());
beforeEach(resetAll);

describe('history.normalize', () => {
    it('texto recebido', () => {
        const fields = history.normalize(incoming({ id: 'abc' }));
        expect(fields).toMatchObject({
            waMessageId: 'abc',
            chatId: '556334140378@c.us',
            fromMe: false,
            type: 'chat',
            body: 'Olá!',
            pushName: 'Maria',
            isGroup: false
        });
        expect(fields.timestamp.toISOString()).toBe(new Date(1791300000 * 1000).toISOString());
    });

    it('mídia não guarda a miniatura do body; grupo guarda o autor', () => {
        const fields = history.normalize(
            incoming({
                type: 'image',
                body: '/9j/4AAQ...',
                caption: 'foto',
                mimetype: 'image/jpeg',
                from: '120363@g.us',
                isGroupMsg: true,
                author: '5511911111111@c.us'
            })
        );
        expect(fields).toMatchObject({ body: null, caption: 'foto', isGroup: true, author: '5511911111111@c.us' });
    });

    it('mensagem enviada pelo celular usa o "to" como chat e id serializado', () => {
        const fields = history.normalize(
            incoming({
                fromMe: true,
                id: { _serialized: 'true_1' },
                from: '5511900000000@c.us',
                to: '556334140378@c.us'
            })
        );
        expect(fields).toMatchObject({
            waMessageId: 'true_1',
            chatId: '556334140378@c.us',
            fromMe: true,
            pushName: null
        });
    });
});

describe('history.recordIncoming', () => {
    it('cria contato, conversa e mensagem; conta não lidas; emite evento', async () => {
        const seen = [];
        const listener = event => seen.push(event);
        events.on('message.saved', listener);
        await history.recordIncoming('s1', incoming(), fakeClient());
        await history.recordIncoming('s1', incoming({ body: 'tudo bem?' }), fakeClient());
        events.off('message.saved', listener);

        const contact = await db().contact.findFirst({ include: { conversations: true } });
        expect(contact).toMatchObject({ waId: '556334140378@c.us', pushName: 'Maria' });
        expect(contact.conversations).toHaveLength(1);
        // sessão sem bot (botMode off): conversa nasce aguardando atendente
        expect(contact.conversations[0]).toMatchObject({ status: 'pending', unreadCount: 2 });
        expect(await db().message.count()).toBe(2);
        expect(seen.map(event => event.message.body)).toEqual(['Olá!', 'tudo bem?']);
    });

    it('com bot ativo, a conversa nasce com o bot', async () => {
        await db().session.create({ data: { name: 'bot1', engine: 'WPPCONNECT', botMode: 'flow' } });
        await history.recordIncoming('bot1', incoming());
        expect((await db().conversation.findFirst()).status).toBe('bot');
    });

    it('não grava duplicado nem eventos de sistema/status', async () => {
        const message = incoming({ id: 'dup' });
        await history.recordIncoming('s1', message);
        await history.recordIncoming('s1', message);
        await history.recordIncoming('s1', incoming({ type: 'e2e_notification' }));
        await history.recordIncoming('s1', incoming({ from: 'status@broadcast' }));
        expect(await db().message.count()).toBe(1);
    });

    it('conversa encerrada: próxima mensagem abre outra', async () => {
        await history.recordIncoming('s1', incoming());
        await db().conversation.updateMany({ data: { status: 'closed' } });
        await history.recordIncoming('s1', incoming());
        expect(await db().conversation.count()).toBe(2);
    });

    it('baixa a mídia para DATA_DIR/media e avisa com message.updated', async () => {
        const client = fakeClient();
        const updates = [];
        const listener = event => updates.push(event);
        events.on('message.updated', listener);
        const saved = await history.recordIncoming(
            's1',
            incoming({ type: 'image', mimetype: 'image/jpeg', id: 'false_img_1' }),
            client
        );
        expect(client.decryptFile).toHaveBeenCalled();
        events.off('message.updated', listener);
        expect(updates[0].message.mediaPath).toBe(saved.mediaPath);
        expect(saved.mediaPath).toMatch(/^s1\/\d{4}-\d{2}\/false_img_1\.jpg$/);
        expect(fs.readFileSync(history.mediaAbsolutePath(saved.mediaPath), 'utf8')).toBe('media-bytes');
    });

    it('envio pela API e o eco do onAnyMessage viram uma mensagem só, com origem api', async () => {
        await history.recordOutgoing('s1', '556334140378@c.us', { type: 'chat', body: 'oi' }, { id: 'true_echo' });
        await history.recordIncoming(
            's1',
            incoming({ id: 'true_echo', fromMe: true, to: '556334140378@c.us', body: 'oi' })
        );
        const messages = await db().message.findMany();
        expect(messages).toHaveLength(1);
        expect(messages[0]).toMatchObject({ origin: 'api', direction: 'out' });

        // eco chegando antes: a API completa a origem
        await history.recordIncoming('s1', incoming({ id: 'true_echo2', fromMe: true, to: '556334140378@c.us' }));
        await history.recordOutgoing('s1', '556334140378@c.us', { type: 'chat', body: 'x' }, { id: 'true_echo2' });
        expect((await db().message.findFirst({ where: { waMessageId: 'true_echo2' } })).origin).toBe('api');
    });

    it('mediaAbsolutePath bloqueia path traversal', () => {
        expect(history.mediaAbsolutePath('../../etc/passwd')).toBeNull();
        expect(history.mediaAbsolutePath(null)).toBeNull();
    });
});
