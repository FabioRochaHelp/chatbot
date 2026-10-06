import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// em dev o Vite (5173) repassa API e WebSocket para o servidor (3333): mesmo origin, cookie funciona
const target = process.env.MYZAP_API_URL || 'http://localhost:3333';

export default defineConfig({
    plugins: [react(), tailwindcss()],
    resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
    server: {
        proxy: {
            '/api': target,
            '/socket.io': { target, ws: true }
        }
    }
});
