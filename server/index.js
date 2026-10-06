'use strict';

const fs = require('fs');
const https = require('https');
const config = require('./config');
const log = require('./logger');
const Sessions = require('./sessions');
const { createApp } = require('./app');
const { disconnect } = require('./db');
const { migrate } = require('./migrate');
const realtime = require('./realtime');
const auth = require('./auth');
const webhooks = require('./webhooks');
const metrics = require('./metrics');

migrate();

const app = createApp({ config, sessions: Sessions });

var server;
if (config.https) {
    //with ssl
    server = https
        .createServer(
            {
                key: fs.readFileSync(config.sslKeyPath),
                cert: fs.readFileSync(config.sslCertPath)
            },
            app
        )
        .listen(config.port, '0.0.0.0', () => {
            log.info({ port: config.port, engine: config.engine }, 'https server running');
        });
} else {
    //http
    server = app.listen(config.port, '0.0.0.0', () => {
        log.info({ port: config.port, engine: config.engine }, 'http server running');
    });
} //http

realtime.attach(server, { Sessions });
metrics.start({ Sessions });
webhooks.worker.start();

if (process.env.JSONBINIO_SECRET_KEY) {
    log.warn(
        'JSONBINIO_* não é mais usado (não funciona com o WhatsApp multidevice); as sessões ficam no volume tokens'
    );
}
if (config.engine === 'VENOM') {
    log.warn('ENGINE=VENOM está obsoleto (venom-bot sem atualizações desde 11/2024); prefira WPPCONNECT');
}

server.once('listening', async () => {
    await auth.seedAdmin().catch(error => log.error({ err: error }, 'falha ao criar o administrador inicial'));
    Sessions.restore().catch(error => log.error({ err: error }, 'falha ao restaurar sessões'));
});

var shuttingDown = false;
async function shutdown(signal, exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info({ signal }, 'fechando sessões...');
    server.close();
    await Promise.all(Sessions.getSessions().map(session => Sessions.closeSession(session.name, { shutdown: true })));
    await disconnect().catch(() => null);
    process.exit(exitCode);
} //shutdown

// SIGTERM: docker stop / kill; SIGINT: ctrl+c; SIGUSR2: nodemon restart
['SIGTERM', 'SIGINT', 'SIGUSR2'].forEach(signal => process.on(signal, () => shutdown(signal)));
process.on('uncaughtException', error => {
    log.fatal({ err: error }, 'uncaughtException');
    shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', error => {
    log.error({ err: error }, 'unhandledRejection');
});
