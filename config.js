'use strict';

const path = require('path');
require('dotenv').config();

const ENGINES = ['VENOM', 'WPPCONNECT'];

const engine = (process.env.ENGINE || 'WPPCONNECT').toUpperCase();
if (!ENGINES.includes(engine)) {
    throw new Error('ENGINE inválido: "' + process.env.ENGINE + '". Use ' + ENGINES.join(' ou '));
}

module.exports = {
    port: parseInt(process.env.PORT, 10) || 3333,
    engine: engine,
    tokensDir: path.resolve(process.env.TOKENS_DIR || './tokens'),
    chromePath: process.env.CHROME_PATH || undefined,
    apiToken: process.env.API_TOKEN || null,
    https: process.env.HTTPS == 1,
    sslKeyPath: process.env.SSL_KEY_PATH,
    sslCertPath: process.env.SSL_CERT_PATH,
    jsonbinio: process.env.JSONBINIO_SECRET_KEY ? {
        binId: process.env.JSONBINIO_BIN_ID,
        secretKey: process.env.JSONBINIO_SECRET_KEY
    } : null
};
