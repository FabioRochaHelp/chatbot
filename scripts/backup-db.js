'use strict';

/**
 * Backup do SQLite: cópia consistente mesmo com o servidor rodando (API de backup do SQLite).
 * Uso: npm run db:backup [-- --keep 14]   (padrão: guarda os 14 mais recentes)
 * Arquivos em DATA_DIR/backups/myzap-AAAAMMDD-HHMMSS.db
 */
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const config = require('../server/config');

async function main() {
    if (!config.databaseUrl.startsWith('file:')) {
        console.error('DATABASE_URL não é SQLite: use a ferramenta de backup do seu banco.');
        process.exit(1);
    }
    const source = config.databaseUrl.replace(/^file:/, '');
    const keepIndex = process.argv.indexOf('--keep');
    const keep = keepIndex > 0 ? Number(process.argv[keepIndex + 1]) || 14 : 14;
    const dir = path.join(config.dataDir, 'backups');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const target = path.join(dir, `myzap-${stamp}.db`);

    const db = new Database(source, { readonly: true, fileMustExist: true });
    await db.backup(target);
    db.close();
    console.log('backup criado:', target, `(${Math.round(fs.statSync(target).size / 1024)} KB)`);

    const old = fs
        .readdirSync(dir)
        .filter(name => /^myzap-\d{8}-\d{6}\.db$/.test(name))
        .sort()
        .reverse()
        .slice(keep);
    for (const name of old) fs.rmSync(path.join(dir, name));
    if (old.length) console.log('removidos', old.length, 'backups antigos');
}

main().catch(error => {
    console.error('falha no backup:', error.message);
    process.exit(1);
});
