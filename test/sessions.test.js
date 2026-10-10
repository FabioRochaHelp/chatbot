import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Sessions, server } from './helpers.js';

const wppconnect = server('../server/engine/wppconnect.js');
const venom = server('../server/engine/venom.js');

function connected(name, client) {
    const session = { name, state: 'CONNECTED', client: Promise.resolve(client) };
    Sessions.sessions = [session];
    return session;
}

describe('Sessions.withClient', () => {
    beforeEach(() => {
        Sessions.sessions = [];
    });

    it('retorna NOTFOUND e o estado quando não está conectada', async () => {
        expect(await Sessions.sendText('s1', '1@c.us', 'oi')).toEqual({ result: 'error', message: 'NOTFOUND' });
        Sessions.sessions = [{ name: 's1', state: 'QRCODE' }];
        expect(await Sessions.sendText('s1', '1@c.us', 'oi')).toEqual({ result: 'error', message: 'QRCODE' });
    });

    it('envia texto e captura erro do client', async () => {
        const client = { sendText: vi.fn().mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('falhou')) };
        connected('s1', client);
        expect(await Sessions.sendText('s1', '1@c.us', 'oi')).toEqual({ result: 'success' });
        expect(client.sendText).toHaveBeenCalledWith('1@c.us', 'oi');
        expect(await Sessions.sendText('s1', '1@c.us', 'oi')).toEqual({ result: 'error', message: 'falhou' });
    });

    it('story vai para status@broadcast', async () => {
        const client = { sendText: vi.fn().mockResolvedValue({}) };
        connected('s1', client);
        await Sessions.sendTextToStorie('s1', 'novidade');
        expect(client.sendText).toHaveBeenCalledWith('status@broadcast', 'novidade');
    });

    it('sendFile grava arquivo temporário com basename seguro e apaga depois', async () => {
        let sentPath;
        const client = {
            sendFile: vi.fn(async (to, filePath) => {
                sentPath = filePath;
            })
        };
        connected('s1', client);
        const fs = await import('fs');
        await Sessions.sendFile('s1', '1@c.us', Buffer.from('oi').toString('base64'), '../../etc/passwd', 'c');
        expect(client.sendFile).toHaveBeenCalledWith('1@c.us', sentPath, 'passwd', 'c');
        expect(fs.existsSync(sentPath)).toBe(false);
    });

    it('saveHook exige sessão existente', async () => {
        expect((await Sessions.saveHook('s1', 'https://x')).result).toBe('error');
        Sessions.sessions = [{ name: 's1' }];
        expect((await Sessions.saveHook('s1', 'https://x')).result).toBe('success');
        expect(Sessions.getSession('s1').hook).toBe('https://x');
    });
});

describe('adapters de engine', () => {
    it('wppconnect', async () => {
        const client = { sendPttFromBase64: vi.fn(), sendLinkPreview: vi.fn(), listChats: vi.fn() };
        await wppconnect.sendVoice(client, '1@c.us', 'b64');
        await wppconnect.sendLinkPreview(client, '1@c.us', 'https://x', 'c');
        await wppconnect.getAllChatsNewMsg(client);
        expect(client.sendPttFromBase64).toHaveBeenCalledWith('1@c.us', 'b64', 'voice.ogg');
        expect(client.sendLinkPreview).toHaveBeenCalledWith('1@c.us', 'https://x', 'c');
        expect(client.listChats).toHaveBeenCalledWith({ onlyWithUnreadMessage: true });
    });

    it('venom', async () => {
        const client = { sendVoiceBase64: vi.fn(), sendLinkPreview: vi.fn(), getAllChatsNewMsg: vi.fn() };
        await venom.sendVoice(client, '1@c.us', 'b64');
        await venom.sendLinkPreview(client, '1@c.us', 'https://x');
        await venom.getAllChatsNewMsg(client);
        expect(client.sendVoiceBase64).toHaveBeenCalledWith('1@c.us', 'b64');
        expect(client.sendLinkPreview).toHaveBeenCalledWith('1@c.us', 'https://x', '', '');
        expect(client.getAllChatsNewMsg).toHaveBeenCalled();
    });
});
