'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const log = require('../logger');

const LOCK_FILES = ['SingletonLock', 'SingletonSocket', 'SingletonCookie'];

function processAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        // EPERM: existe, mas é de outro usuário
        return error.code === 'EPERM';
    }
}

/**
 * Remove a trava velha do perfil do Chromium antes de abrir a sessão.
 *
 * O Chromium grava em SingletonLock "<hostname>-<pid>" de quem abriu o perfil. Se o container foi recriado
 * (outro hostname) ou derrubado sem fechar o navegador, a trava fica para trás e o Chromium novo acha que o
 * perfil está em uso "em outro computador": tenta mostrar um aviso na tela e, numa VPS sem tela, falha com
 * "Can't open display". Só apaga quando a trava é de outra máquina ou de um processo que não existe mais.
 * Devolve true se apagou.
 */
function clearStaleProfileLock(profileDir) {
    const lockPath = path.join(profileDir, 'SingletonLock');
    let target;
    try {
        target = fs.readlinkSync(lockPath);
    } catch (error) {
        return false; // sem trava
    }
    const match = /^(.*)-(\d+)$/.exec(target);
    const sameHost = match && match[1] === os.hostname();
    if (sameHost && processAlive(Number(match[2]))) return false; // perfil realmente em uso
    for (const name of LOCK_FILES) {
        fs.rmSync(path.join(profileDir, name), { force: true });
    }
    log.warn({ profileDir, lock: target }, 'trava antiga do Chromium removida (container recriado ou fechado à força)');
    return true;
}

module.exports = { clearStaleProfileLock };
