import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { server } from './helpers.js';

const configPath = server.resolve('../server/config.js');

/** Carrega a config com outro DATA_DIR (sem DATABASE_URL), fora do cache do require. */
function loadConfig(dataDir) {
    const previous = { DATA_DIR: process.env.DATA_DIR, DATABASE_URL: process.env.DATABASE_URL };
    process.env.DATA_DIR = dataDir;
    delete process.env.DATABASE_URL;
    delete server.cache[configPath];
    try {
        return server('../server/config.js');
    } finally {
        delete server.cache[configPath];
        Object.assign(process.env, previous);
    }
}

const dirs = [];
afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));

describe('banco padrão', () => {
    it('instalação nova usa conectzap.db', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-'));
        dirs.push(dir);
        expect(loadConfig(dir).databaseUrl).toBe('file:' + path.join(dir, 'conectzap.db'));
    });

    it('instalação antiga (MyZap) continua usando o myzap.db existente', () => {
        const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-'));
        dirs.push(dir);
        fs.writeFileSync(path.join(dir, 'myzap.db'), '');
        expect(loadConfig(dir).databaseUrl).toBe('file:' + path.join(dir, 'myzap.db'));
    });
});
