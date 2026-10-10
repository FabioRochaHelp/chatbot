import type { Contact, Conversation, ConversationStatus, Message } from './types';
import { formatWaId } from './utils';

/** URL da foto guardada; ?v muda quando a foto é consultada de novo (fura o cache). */
export const avatarUrl = (contact: Contact) =>
    contact.avatarPath
        ? `/api/v1/contacts/${contact.id}/avatar?v=${Date.parse(contact.avatarCheckedAt ?? '') || 0}`
        : null;

export const contactName = (contact: Contact) => contact.name || contact.pushName || formatWaId(contact.waId);

export function initials(name: string) {
    const parts = name
        .replace(/[^\p{L}\p{N} ]/gu, '')
        .trim()
        .split(/\s+/);
    return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase() || '#';
}

export const STATUS_LABEL: Record<ConversationStatus, string> = {
    bot: 'Com o bot',
    pending: 'Aguardando',
    open: 'Em atendimento',
    closed: 'Encerrada'
};

const MEDIA_LABEL: Record<string, string> = {
    image: 'Foto',
    video: 'Vídeo',
    audio: 'Áudio',
    ptt: 'Áudio',
    document: 'Documento',
    sticker: 'Figurinha',
    location: 'Localização',
    vcard: 'Contato',
    multi_vcard: 'Contatos'
};

/** Texto curto para a lista de conversas. */
export function preview(message: Message | null) {
    if (!message) return '';
    const label = MEDIA_LABEL[message.type];
    const text = message.body || message.caption || message.fileName || '';
    if (label) return text && message.type !== 'vcard' ? `${label}: ${text}` : label;
    return text;
}

export function statusTone(conversation: Conversation) {
    if (conversation.status === 'pending') return 'warning' as const;
    if (conversation.status === 'open') return 'success' as const;
    if (conversation.status === 'bot') return 'info' as const;
    return 'neutral' as const;
}
