'use strict';

const { z } = require('zod');
const { toChatId } = require('./phone');

// vira nome de pasta em TOKENS_DIR: sem "/", sem começar com "." (evita path traversal)
const sessionName = z
    .string()
    .trim()
    .regex(/^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/, 'sessionName inválido');

// número (string ou number, com ou sem máscara) ou id do WhatsApp -> "<id>@c.us"
const chatId = z.union([z.string(), z.number()]).transform((value, ctx) => {
    const id = toChatId(value);
    if (!id) {
        ctx.addIssue({ code: 'custom', message: 'número inválido' });
        return z.NEVER;
    }
    return id;
});

const text = z.string().min(1);
const optionalText = z.string().optional();
const coordinate = z.union([z.string().min(1), z.number()]);

module.exports = {
    sessionName,
    chatId,
    session: z.object({ sessionName }),
    qrcode: z.object({ sessionName, image: z.any().optional() }),
    hook: z.object({ sessionName, hook: z.union([z.url(), z.literal(''), z.null()]).optional() }),
    sendText: z.object({ sessionName, number: chatId, text }),
    sendTextToStorie: z.object({ sessionName, text }),
    sendFile: z.object({ sessionName, number: chatId, base64Data: text, fileName: text, caption: optionalText }),
    sendImageStorie: z.object({ sessionName, base64Data: text, fileName: text, caption: optionalText }),
    sendLink: z.object({ sessionName, number: chatId, url: z.url(), caption: optionalText }),
    sendContactVcard: z.object({ sessionName, number: chatId, numberCard: chatId, nameCard: optionalText }),
    sendVoice: z.object({ sessionName, number: chatId, voice: text }),
    sendLocation: z.object({ sessionName, number: chatId, lat: coordinate, long: coordinate, local: optionalText }),
    number: z.object({ sessionName, number: chatId })
};
