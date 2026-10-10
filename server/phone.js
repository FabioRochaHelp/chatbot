'use strict';

// sufixos de id que o WhatsApp aceita como destino
const WA_ID = /^[\w.-]+@(c\.us|g\.us|lid|broadcast)$/;

/**
 * Converte o "number" recebido na API em id do WhatsApp.
 * Aceita ids completos (5511999999999@c.us, 1203...@g.us, status@broadcast)
 * ou só o número, com ou sem máscara (+55 (11) 99999-9999).
 * Retorna null se não for válido.
 */
function toChatId(number) {
    if (typeof number === 'number') number = String(number);
    if (typeof number !== 'string') return null;
    const value = number.trim();
    if (WA_ID.test(value)) return value;
    const digits = value.replace(/[\s()+.-]/g, '');
    if (!/^\d{8,15}$/.test(digits)) return null;
    return digits + '@c.us';
}

module.exports = { toChatId };
