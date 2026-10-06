'use strict';

const { z } = require('zod');
const { sessionName, chatId } = require('../../schemas');

const optionalText = z.string().max(4096).optional();
const base64 = z.string().min(1).describe('base64 puro ou data URL (data:...;base64,...)');

// conteúdo da mensagem; o destino vem do "to" ou da conversa
const content = z.discriminatedUnion('type', [
    z.object({ type: z.literal('text'), text: z.string().min(1).max(65536) }),
    z.object({ type: z.literal('file'), base64, fileName: z.string().min(1).max(255), caption: optionalText }),
    z.object({ type: z.literal('voice'), base64: base64.describe('áudio OGG/Opus em base64') }),
    z.object({
        type: z.literal('location'),
        lat: z.number().min(-90).max(90),
        lng: z.number().min(-180).max(180),
        name: optionalText
    }),
    z.object({ type: z.literal('link'), url: z.url(), caption: optionalText }),
    z.object({ type: z.literal('contact'), contact: chatId, name: optionalText })
]);

const statuses = ['bot', 'pending', 'open', 'closed'];
const botModes = ['off', 'flow', 'ai', 'flow+ai'];

module.exports = {
    content,
    sendMessage: content.and(z.object({ to: chatId.describe('número (com DDI) ou id do WhatsApp') })),
    sessionParams: z.object({ name: sessionName }),
    idParams: z.object({ id: z.coerce.number().int().positive() }),
    numberParams: z.object({ name: sessionName, number: chatId }),
    createSession: z.object({
        name: sessionName,
        autoStart: z.boolean().default(true),
        botMode: z.enum(botModes).default('off')
    }),
    updateSession: z.object({ autoStart: z.boolean().optional(), botMode: z.enum(botModes).optional() }),
    qrcodeQuery: z.object({ format: z.enum(['json', 'png']).default('json') }),
    status: z.enum(statuses),
    statuses,
    updateConversation: z.object({
        status: z.enum(statuses).optional(),
        assignedUserId: z.number().int().positive().nullable().optional().describe('atendente (null tira)'),
        read: z.literal(true).optional().describe('zera o contador de não lidas')
    }),
    updateContact: z.object({
        name: z.string().max(255).nullable().optional(),
        tags: z.array(z.string().min(1).max(50)).max(50).optional()
    })
};
