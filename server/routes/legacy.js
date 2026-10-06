'use strict';

const express = require('express');
const schemas = require('../schemas');
const { validated } = require('../http');

// rotas originais do MyZap: mesmo caminho, método e formato { result, message }
module.exports = function legacyRoutes(Sessions) {
    const router = express.Router();

    router.get(
        '/start',
        validated(schemas.session, async ({ sessionName }) => {
            var session = await Sessions.start(sessionName);
            if (['CONNECTED', 'QRCODE', 'STARTING'].includes(session.state)) {
                return { result: 'success', message: session.state };
            }
            return { result: 'error', message: session.state };
        })
    );

    router.get(
        '/status',
        validated(schemas.session, async ({ sessionName }) => {
            var session = await Sessions.getStatus(sessionName);
            return { result: !session.state ? 'NOT_FOUND' : session.state };
        })
    );

    router.get(
        '/qrcode',
        validated(schemas.qrcode, async ({ sessionName, image }, req, res) => {
            var session = Sessions.getSession(sessionName);
            if (!session) {
                return { result: 'error', message: 'NOTFOUND' };
            }
            if (session.status == 'isLogged') {
                return { result: 'error', message: session.state };
            }
            if (!image) {
                return { result: 'success', message: session.state, qrcode: session.qrcode };
            }
            if (!session.qrcode) {
                return { result: 'error', message: session.state };
            }
            const imageBuffer = Buffer.from(session.qrcode.replace('data:image/png;base64,', ''), 'base64');
            res.writeHead(200, {
                'Content-Type': 'image/png',
                'Content-Length': imageBuffer.length
            });
            res.end(imageBuffer);
        })
    );

    router.post(
        '/sendHook',
        validated(schemas.hook, ({ sessionName, hook }) => Sessions.saveHook(sessionName, hook))
    );

    router.post(
        '/sendText',
        validated(schemas.sendText, ({ sessionName, number, text }) => Sessions.sendText(sessionName, number, text))
    );

    router.post(
        '/sendTextToStorie',
        validated(schemas.sendTextToStorie, ({ sessionName, text }) => Sessions.sendTextToStorie(sessionName, text))
    );

    router.post(
        '/sendFile',
        validated(schemas.sendFile, p =>
            Sessions.sendFile(p.sessionName, p.number, p.base64Data, p.fileName, p.caption)
        )
    );

    router.post(
        '/sendImageStorie',
        validated(schemas.sendImageStorie, p =>
            Sessions.sendImageStorie(p.sessionName, p.base64Data, p.fileName, p.caption)
        )
    );

    router.post(
        '/sendLink',
        validated(schemas.sendLink, p => Sessions.sendLinkPreview(p.sessionName, p.number, p.url, p.caption))
    );

    router.post(
        '/sendContactVcard',
        validated(schemas.sendContactVcard, p =>
            Sessions.sendContactVcard(p.sessionName, p.number, p.numberCard, p.nameCard)
        )
    );

    router.post(
        '/sendVoice',
        validated(schemas.sendVoice, p => Sessions.sendVoice(p.sessionName, p.number, p.voice))
    );

    router.post(
        '/sendLocation',
        validated(schemas.sendLocation, p => Sessions.sendLocation(p.sessionName, p.number, p.lat, p.long, p.local))
    );

    router.get(
        '/getAllChatsNewMsg',
        validated(schemas.session, ({ sessionName }) => Sessions.getAllChatsNewMsg(sessionName))
    );

    router.get(
        '/getAllUnreadMessages',
        validated(schemas.session, ({ sessionName }) => Sessions.getAllUnreadMessages(sessionName))
    );

    router.get(
        '/checkNumberStatus',
        validated(schemas.number, ({ sessionName, number }) => Sessions.checkNumberStatus(sessionName, number))
    );

    router.get(
        '/getNumberProfile',
        validated(schemas.number, ({ sessionName, number }) => Sessions.getNumberProfile(sessionName, number))
    );

    router.get(
        '/close',
        validated(schemas.session, async ({ sessionName }) => {
            return Sessions.closeSession(sessionName);
        })
    );

    return router;
};
