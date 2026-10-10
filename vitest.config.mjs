import os from 'os';
import path from 'path';
import { defineConfig } from 'vitest/config';

// banco descartável por execução; o global-setup aplica as migrations nele
const dataDir = path.join(os.tmpdir(), 'conectzap-test-' + process.pid);
process.env.DATA_DIR = dataDir;
process.env.DATABASE_URL = 'file:' + path.join(dataDir, 'test.db');

export default defineConfig({
    test: {
        include: ['test/**/*.test.js'],
        globalSetup: ['test/global-setup.mjs'],
        // os arquivos compartilham o mesmo SQLite
        fileParallelism: false,
        env: { LOG_LEVEL: 'silent', ENGINE: 'WPPCONNECT', API_TOKEN: '', JSONBINIO_SECRET_KEY: '' }
    }
});
