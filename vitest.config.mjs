import { defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        include: ['test/**/*.test.js'],
        env: { LOG_LEVEL: 'silent', ENGINE: 'WPPCONNECT', API_TOKEN: '', JSONBINIO_SECRET_KEY: '' }
    }
});
