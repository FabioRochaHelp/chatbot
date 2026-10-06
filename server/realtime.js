'use strict';

const { Server } = require('socket.io');
const config = require('./config');
const auth = require('./auth');
const events = require('./events');
const log = require('./logger');

/**
 * Socket.IO em /socket.io. Autentica pelo cookie do painel ou por auth.token
 * (chave de API / API_TOKEN). Salas: "all" (todos), "managers" (admin/integração), "user:<id>".
 *
 * Eventos enviados: session.state, session.qrcode (só managers), message.saved, message.updated,
 * conversation.updated, contact.updated.
 */
function attach(httpServer, { Sessions }) {
    const io = new Server(httpServer, {
        path: '/socket.io',
        serveClient: false,
        cors: config.corsOrigins.length ? { origin: config.corsOrigins, credentials: true } : undefined
    });

    io.use((socket, next) => {
        const { headers } = socket.handshake;
        const token = socket.handshake.auth && socket.handshake.auth.token;
        auth.resolvePrincipal({
            bearer: typeof token === 'string' ? token : null,
            cookie: auth.parseCookies(headers.cookie)[auth.COOKIE] || null,
            queryToken: null
        })
            .then(principal => {
                if (!principal) return next(new Error('UNAUTHORIZED'));
                socket.data.principal = principal;
                next();
            })
            .catch(next);
    });

    io.on('connection', socket => {
        const { principal } = socket.data;
        socket.join('all');
        if (principal.role !== 'agent') socket.join('managers');
        if (principal.user) socket.join('user:' + principal.user.id);
        // estado atual para a tela não depender do próximo evento
        socket.emit(
            'sessions',
            Sessions.getSessions().map(session => ({ name: session.name, state: session.state }))
        );
    });

    const listeners = {
        'session.state': payload => io.to('all').emit('session.state', payload),
        'session.qrcode': payload => io.to('managers').emit('session.qrcode', payload),
        'message.saved': payload => io.to('all').emit('message.saved', payload),
        'message.updated': payload => io.to('all').emit('message.updated', payload),
        'conversation.updated': payload => io.to('all').emit('conversation.updated', payload),
        'contact.updated': payload => io.to('all').emit('contact.updated', payload),
        // senha trocada, usuário desativado/removido: derruba as conexões abertas
        'user.revoked': ({ userId }) => io.in('user:' + userId).disconnectSockets(true)
    };
    for (const [name, listener] of Object.entries(listeners)) events.on(name, listener);

    log.info('realtime (socket.io) ativo');
    return {
        io,
        close() {
            for (const [name, listener] of Object.entries(listeners)) events.off(name, listener);
            return new Promise(resolve => io.close(() => resolve()));
        }
    };
}

module.exports = { attach };
