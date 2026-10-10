'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const config = require('./config');
const log = require('./logger');

/**
 * Aplica as migrations pendentes (prisma migrate deploy) antes de abrir a porta,
 * para que Docker, pm2 e Procfile funcionem sem passo extra. DB_MIGRATE=0 desativa.
 */
function migrate() {
    if (!config.dbMigrate) return;
    if (config.databaseUrl.startsWith('file:')) fs.mkdirSync(config.dataDir, { recursive: true });
    const cli = require.resolve('prisma/build/index.js');
    try {
        execFileSync(process.execPath, [cli, 'migrate', 'deploy'], {
            cwd: path.join(__dirname, '..'),
            env: { ...process.env, DATABASE_URL: config.databaseUrl },
            stdio: 'pipe'
        });
        log.info('migrations aplicadas');
    } catch (error) {
        log.fatal({ output: String(error.stdout || '') + String(error.stderr || '') }, 'falha nas migrations');
        throw error;
    }
}

module.exports = { migrate };
