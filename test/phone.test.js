import { describe, it, expect } from 'vitest';
import { toChatId } from '../server/phone.js';

describe('toChatId', () => {
    it('aceita número puro, number e com máscara', () => {
        expect(toChatId('556334140378')).toBe('556334140378@c.us');
        expect(toChatId(556334140378)).toBe('556334140378@c.us');
        expect(toChatId('+55 (63) 3414-0378')).toBe('556334140378@c.us');
    });

    it('mantém ids completos do WhatsApp', () => {
        expect(toChatId('556334140378@c.us')).toBe('556334140378@c.us');
        expect(toChatId('120363000000000000@g.us')).toBe('120363000000000000@g.us');
        expect(toChatId('status@broadcast')).toBe('status@broadcast');
    });

    it('rejeita entradas inválidas', () => {
        expect(toChatId('')).toBeNull();
        expect(toChatId('abc')).toBeNull();
        expect(toChatId('123')).toBeNull();
        expect(toChatId('5563@evil.com')).toBeNull();
        expect(toChatId(undefined)).toBeNull();
        expect(toChatId({})).toBeNull();
    });
});
