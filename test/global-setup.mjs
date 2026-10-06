import fs from 'fs';
import { execFileSync } from 'child_process';

export function setup() {
    fs.mkdirSync(process.env.DATA_DIR, { recursive: true });
    execFileSync('npx', ['prisma', 'migrate', 'deploy'], { stdio: 'ignore', env: process.env });
}

export function teardown() {
    fs.rmSync(process.env.DATA_DIR, { recursive: true, force: true });
}
