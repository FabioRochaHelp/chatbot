'use strict';

const fs = require('fs');
const path = require('path');
const config = require('./config');
const { db } = require('./db');
const history = require('./history');
const webhooks = require('./webhooks');
const log = require('./logger');

function removeQuietly(target) {
    try {
        fs.rmSync(target, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
    } catch (error) {
        log.warn({ path: target, err: error }, 'não foi possível apagar');
    }
}

/**
 * Apaga tudo o que pertence à sessão (o navegador já deve estar fechado):
 * registro no banco (cascata: contatos, conversas, mensagens, webhooks e entregas),
 * mídias e fotos dos contatos (pelo caminho gravado no banco) e o login do WhatsApp em TOKENS_DIR.
 * Fluxos, assistentes de IA, usuários e chaves de API não pertencem a uma sessão e ficam.
 * Devolve quantos itens foram apagados.
 */
async function deleteSessionData(sessionName) {
    const session = await db().session.findUnique({ where: { name: sessionName }, select: { id: true } });
    const counts = { conversations: 0, messages: 0, files: 0 };
    if (session) {
        // os arquivos saem pelo caminho gravado (não por pasta com o nome da sessão: "avatars" é uma pasta comum)
        const [media, photos] = await Promise.all([
            db().message.findMany({
                where: { sessionId: session.id, mediaPath: { not: null } },
                select: { mediaPath: true }
            }),
            db().contact.findMany({
                where: { sessionId: session.id, avatarPath: { not: null } },
                select: { avatarPath: true }
            })
        ]);
        for (const relative of [...media.map(item => item.mediaPath), ...photos.map(item => item.avatarPath)]) {
            const file = history.mediaAbsolutePath(relative);
            if (file && fs.existsSync(file)) {
                removeQuietly(file);
                counts.files += 1;
            }
        }
        counts.conversations = await db().conversation.count({ where: { sessionId: session.id } });
        counts.messages = await db().message.count({ where: { sessionId: session.id } });
        await db().session.delete({ where: { id: session.id } });
    }
    // pastas que ficaram vazias e o login do WhatsApp (perfil do navegador + arquivo de token)
    if (sessionName !== 'avatars') removeEmptyDir(path.join(config.mediaDir, sessionName));
    removeEmptyDir(path.join(config.mediaDir, 'avatars', sessionName));
    removeQuietly(path.join(config.tokensDir, sessionName));
    removeQuietly(path.join(config.tokensDir, sessionName + '.data.json'));
    history.forgetSession(sessionName);
    webhooks.forgetSession(sessionName);
    return counts;
}

/** Remove a pasta só se não sobrou arquivo nenhum (subpastas vazias contam como vazias). */
function removeEmptyDir(dir) {
    if (!fs.existsSync(dir)) return;
    const hasFiles = current =>
        fs
            .readdirSync(current, { withFileTypes: true })
            .some(entry => (entry.isDirectory() ? hasFiles(path.join(current, entry.name)) : true));
    if (!hasFiles(dir)) removeQuietly(dir);
}

module.exports = { deleteSessionData };
