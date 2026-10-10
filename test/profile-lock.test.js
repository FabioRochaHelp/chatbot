import { describe, it, expect, afterEach } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { server } from './helpers.js';

const { clearStaleProfileLock } = server('../server/engine/profile-lock.js');

const dirs = [];
function profile(lockTarget) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cz-profile-'));
    dirs.push(dir);
    if (lockTarget) {
        fs.symlinkSync(lockTarget, path.join(dir, 'SingletonLock'));
        fs.symlinkSync('/tmp/org.chromium.Chromium.x/SingletonSocket', path.join(dir, 'SingletonSocket'));
        fs.symlinkSync('123', path.join(dir, 'SingletonCookie'));
    }
    fs.writeFileSync(path.join(dir, 'Preferences'), '{}');
    return dir;
}
const lockExists = dir => fs.lstatSync(path.join(dir, 'SingletonLock'), { throwIfNoEntry: false }) !== undefined;

afterEach(() => dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true })));

describe('trava do perfil do Chromium', () => {
    it('remove a trava de outra máquina (container recriado) e mantém o perfil', () => {
        const dir = profile('host-antigo-124');
        expect(clearStaleProfileLock(dir)).toBe(true);
        expect(lockExists(dir)).toBe(false);
        expect(fs.existsSync(path.join(dir, 'SingletonSocket'))).toBe(false);
        expect(fs.existsSync(path.join(dir, 'Preferences'))).toBe(true);
    });

    it('remove a trava desta máquina de um processo que já morreu', () => {
        const dir = profile(`${os.hostname()}-999999`);
        expect(clearStaleProfileLock(dir)).toBe(true);
    });

    it('mantém a trava de um Chromium vivo nesta máquina', () => {
        const dir = profile(`${os.hostname()}-${process.pid}`);
        expect(clearStaleProfileLock(dir)).toBe(false);
        expect(lockExists(dir)).toBe(true);
    });

    it('sem trava ou sem perfil: nada a fazer', () => {
        expect(clearStaleProfileLock(profile(null))).toBe(false);
        expect(clearStaleProfileLock(path.join(os.tmpdir(), 'nao-existe-' + Date.now()))).toBe(false);
    });
});
