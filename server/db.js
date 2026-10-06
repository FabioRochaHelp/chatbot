'use strict';

const fs = require('fs');
const config = require('./config');

let prisma = null;

// conexão preguiçosa: só abre o SQLite quando alguém usa o banco
function db() {
    if (!prisma) {
        const { PrismaClient } = require('@prisma/client');
        const { PrismaBetterSqlite3 } = require('@prisma/adapter-better-sqlite3');
        if (config.databaseUrl.startsWith('file:')) fs.mkdirSync(config.dataDir, { recursive: true });
        prisma = new PrismaClient({ adapter: new PrismaBetterSqlite3({ url: config.databaseUrl }) });
    }
    return prisma;
}

async function disconnect() {
    if (prisma) {
        await prisma.$disconnect();
        prisma = null;
    }
}

module.exports = { db, disconnect };
