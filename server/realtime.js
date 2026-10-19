'use strict';

const { Server } = require('socket.io');
const config = require('./config');
const auth = require('./auth');
const events = require('./events');
const log = require('./logger');
const presence = require('./presence');
const departments = require('./departments');

/**
 * Socket.IO em /socket.io. Autentica pelo cookie do painel ou por auth.token
 * (chave de API / API_TOKEN). Salas: "all" (todos), "managers" (admin/integração), "user:<id>",
 * "department:<id>" (atendentes do departamento).
 *
 * Eventos de conversa e mensagem só vão para quem pode ver a conversa (departments.roomsOf).
 * Eventos enviados: session.state, session.qrcode (só managers), message.saved, message.updated,
 * conversation.updated, conversation.assigned (só para o atendente), contact.updated,
 * departments.changed, presence.changed (só managers).
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

    /** Salas dos departamentos do atendente (refeitas quando os departamentos mudam). */
    async function joinDepartments(socket) {
        const { user, role } = socket.data.principal;
        if (!user || role !== 'agent') return;
        const ids = await departments.idsOf(user.id);
        for (const room of socket.rooms) if (room.startsWith('department:')) socket.leave(room);
        for (const id of ids) socket.join('department:' + id);
    }

    io.on('connection', socket => {
        const { principal } = socket.data;
        socket.join('all');
        if (principal.role !== 'agent') socket.join('managers');
        if (principal.user) {
            socket.join('user:' + principal.user.id);
            presence.connected(principal.user.id);
            socket.on('disconnect', () => presence.disconnected(principal.user.id));
            joinDepartments(socket).catch(error => log.warn({ err: error }, 'falha ao entrar nos departamentos'));
        }
        // estado atual para a tela não depender do próximo evento
        socket.emit(
            'sessions',
            Sessions.getSessions().map(session => ({ name: session.name, state: session.state }))
        );
    });

    const listeners = {
        'session.state': payload => io.to('all').emit('session.state', payload),
        'session.deleted': payload => io.to('all').emit('session.deleted', payload),
        'session.qrcode': payload => io.to('managers').emit('session.qrcode', payload),
        'message.saved': payload => io.to(departments.roomsOf(payload.conversation)).emit('message.saved', payload),
        'message.updated': payload => io.to(departments.roomsOf(payload.conversation)).emit('message.updated', payload),
        // também para quem via a conversa antes (transferida): a lista dele precisa tirá-la
        'conversation.updated': payload =>
            io
                .to([
                    ...departments.roomsOf(payload.conversation),
                    ...(payload.previous ? departments.roomsOf(payload.previous) : [])
                ])
                .emit('conversation.updated', { conversation: payload.conversation }),
        'conversation.assigned': ({ conversation, userId }) =>
            io.to('user:' + userId).emit('conversation.assigned', { conversation }),
        'departments.changed': payload => {
            io.to('all').emit('departments.changed', payload);
            io.fetchSockets()
                .then(sockets => Promise.all(sockets.map(socket => joinDepartments(socket))))
                .catch(() => null);
        },
        'presence.changed': payload => io.to('managers').emit('presence.changed', payload),
        'conversations.changed': payload => io.to('all').emit('conversations.changed', payload),
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
