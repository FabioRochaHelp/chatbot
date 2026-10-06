'use strict';

const pino = require('pino');
const config = require('./config');

function prettyTransport() {
    if (config.env === 'production' || !process.stdout.isTTY) return undefined;
    try {
        require.resolve('pino-pretty'); // devDependency: ausente na imagem de produção
        return { target: 'pino-pretty', options: { translateTime: 'SYS:HH:MM:ss' } };
    } catch (error) {
        return undefined;
    }
}

module.exports = pino({ level: config.logLevel, transport: prettyTransport() });
