'use strict';

const path = require('path');
require('dotenv').config();

const ENGINES = ['VENOM', 'WPPCONNECT'];

const engine = (process.env.ENGINE || 'WPPCONNECT').toUpperCase();
if (!ENGINES.includes(engine)) {
    throw new Error('ENGINE inválido: "' + process.env.ENGINE + '". Use ' + ENGINES.join(' ou '));
}

const dataDir = path.resolve(process.env.DATA_DIR || './data');

function list(value) {
    return (value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

module.exports = {
    env: process.env.NODE_ENV || 'development',
    logLevel: process.env.LOG_LEVEL || 'info',
    // fuso usado no contexto da IA (data/hora atual)
    timezone: process.env.TIMEZONE || 'America/Sao_Paulo',
    // vazio = libera qualquer origem (comportamento antigo)
    corsOrigins: list(process.env.CORS_ORIGINS),
    // requisições por minuto por IP; 0 desativa
    rateLimit:
        process.env.RATE_LIMIT_PER_MINUTE !== undefined ? parseInt(process.env.RATE_LIMIT_PER_MINUTE, 10) || 0 : 600,
    // atrás de proxy reverso (nginx/traefik): TRUST_PROXY=1 para o rate limit ver o IP real
    trustProxy: parseInt(process.env.TRUST_PROXY, 10) || false,
    port: parseInt(process.env.PORT, 10) || 3333,
    engine: engine,
    tokensDir: path.resolve(process.env.TOKENS_DIR || './tokens'),
    dataDir: dataDir,
    databaseUrl: process.env.DATABASE_URL || 'file:' + path.join(dataDir, 'myzap.db'),
    dbMigrate: process.env.DB_MIGRATE !== '0',
    mediaDir: path.join(dataDir, 'media'),
    mediaMaxBytes: (parseInt(process.env.MEDIA_MAX_MB, 10) || 50) * 1024 * 1024,
    chromePath: process.env.CHROME_PATH || undefined,
    apiToken: process.env.API_TOKEN || null,
    // segredo do login do painel; vazio = gerado e salvo em DATA_DIR/jwt-secret
    jwtSecret: process.env.JWT_SECRET || null,
    sessionTtlHours: parseInt(process.env.SESSION_TTL_HOURS, 10) || 168,
    // cookie só por HTTPS; padrão: ligado se HTTPS=1 (atrás de proxy com TLS, use COOKIE_SECURE=1)
    cookieSecure: process.env.COOKIE_SECURE !== undefined ? process.env.COOKIE_SECURE === '1' : process.env.HTTPS == 1,
    // cria este admin no boot se ainda não houver usuários
    adminEmail: process.env.ADMIN_EMAIL || null,
    adminPassword: process.env.ADMIN_PASSWORD || null,
    https: process.env.HTTPS == 1,
    sslKeyPath: process.env.SSL_KEY_PATH,
    sslCertPath: process.env.SSL_CERT_PATH,
    jsonbinio: process.env.JSONBINIO_SECRET_KEY
        ? {
              binId: process.env.JSONBINIO_BIN_ID,
              secretKey: process.env.JSONBINIO_SECRET_KEY
          }
        : null
};
