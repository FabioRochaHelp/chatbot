const fs = require('fs');
const https = require('https');
const express = require("express");
const cors = require('cors');
const config = require('./config');
const Sessions = require("./sessions");

var app = express();

app.use(cors());
app.use(express.json({
    limit: '20mb'
}));

// parâmetros podem vir na query (GET) ou no body (POST / clientes antigos)
function param(req, name) {
    return req.query[name] !== undefined ? req.query[name] : (req.body || {})[name];
}

app.get("/", async (req, res, next) => {
    var result = { "result": "ok" };
    res.json(result);
});//

// autenticação opcional: Authorization: Bearer <API_TOKEN> ou ?token=<API_TOKEN>
app.use((req, res, next) => {
    if (!config.apiToken) return next();
    const header = req.get('Authorization') || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : req.query.token;
    if (token === config.apiToken) return next();
    res.status(401).json({ result: 'error', message: 'UNAUTHORIZED' });
});

app.get("/start", async (req, res, next) => {
    console.log("starting..." + req.query.sessionName);
    var session = await Sessions.start(req.query.sessionName);
    if (["CONNECTED", "QRCODE", "STARTING"].includes(session.state)) {
        res.status(200).json({ result: 'success', message: session.state });
    } else {
        res.status(200).json({ result: 'error', message: session.state });
    }
});//start

app.get("/status", async (req, res, next) => {
    var session = await Sessions.getStatus(req.query.sessionName);
    res.status(200).json({
        result: (!session.state) ? 'NOT_FOUND' : session.state
    });
}); //status

app.get("/qrcode", async (req, res, next) => {
    console.log("qrcode..." + req.query.sessionName);
    var session = Sessions.getSession(req.query.sessionName);

    if (session != false) {
        if (session.status != 'isLogged') {
            if (req.query.image) {
                if (!session.qrcode) {
                    return res.status(200).json({ result: "error", message: session.state });
                }
                const imageBuffer = Buffer.from(session.qrcode.replace('data:image/png;base64,', ''), 'base64');
                res.writeHead(200, {
                    'Content-Type': 'image/png',
                    'Content-Length': imageBuffer.length
                });
                res.end(imageBuffer);
            } else {
                res.status(200).json({ result: "success", message: session.state, qrcode: session.qrcode });
            }
        } else {
            res.status(200).json({ result: "error", message: session.state });
        }
    } else {
        res.status(200).json({ result: "error", message: "NOTFOUND" });
    }
});//qrcode

app.post("/sendHook", async function sendText(req, res, next) {
    var result = await Sessions.saveHook(req);
    res.json(result);
});//sendText

app.post("/sendText", async function sendText(req, res, next) {
    var result = await Sessions.sendText(req);
    res.json(result);
});//sendText

app.post("/sendTextToStorie", async (req, res, next) => {
    var result = await Sessions.sendTextToStorie(req);
    res.json(result);
}); //sendTextToStorie

app.post("/sendFile", async (req, res, next) => {
    var result = await Sessions.sendFile(
        req.body.sessionName,
        req.body.number,
        req.body.base64Data,
        req.body.fileName,
        req.body.caption
    );
    res.json(result);
});//sendFile

app.post("/sendImageStorie", async (req, res, next) => {
    var result = await Sessions.sendImageStorie(
        req.body.sessionName,
        req.body.base64Data,
        req.body.fileName,
        req.body.caption
    );
    res.json(result);
}); //sendImageStorie

app.post("/sendLink", async (req, res, next) => {
    var result = await Sessions.sendLinkPreview(
        req.body.sessionName,
        req.body.number,
        req.body.url,
        req.body.caption
    );
    res.json(result);
}); //sendLinkPreview

app.post("/sendContactVcard", async (req, res, next) => {
    var result = await Sessions.sendContactVcard(
        req.body.sessionName,
        req.body.number,
        req.body.numberCard,
        req.body.nameCard
    );
    res.json(result);
}); //sendContactVcard

app.post("/sendVoice", async (req, res, next) => {
    var result = await Sessions.sendVoice(
        req.body.sessionName,
        req.body.number,
        req.body.voice
    );
    res.json(result);
}); //sendVoice

app.post("/sendLocation", async (req, res, next) => {
    var result = await Sessions.sendLocation(
        req.body.sessionName,
        req.body.number,
        req.body.lat,
        req.body.long,
        req.body.local
    );
    res.json(result);
}); //sendLocation

app.get("/getAllChatsNewMsg", async (req, res, next) => {
    var result = await Sessions.getAllChatsNewMsg(param(req, 'sessionName'));
    res.json(result);
}); //getAllChatsNewMsg

app.get("/getAllUnreadMessages", async (req, res, next) => {
    var result = await Sessions.getAllUnreadMessages(param(req, 'sessionName'));
    res.json(result);
}); //getAllUnreadMessages

app.get("/checkNumberStatus", async (req, res, next) => {
    var result = await Sessions.checkNumberStatus(
        param(req, 'sessionName'),
        param(req, 'number')
    );
    res.json(result);
}); //Verifica Numero

app.get("/getNumberProfile", async (req, res, next) => {
    var result = await Sessions.getNumberProfile(
        param(req, 'sessionName'),
        param(req, 'number')
    );
    res.json(result);
}); //Verifica perfil

app.get("/close", async (req, res, next) => {
    await Sessions.clearCloudToken();
    var result = await Sessions.closeSession(req.query.sessionName);
    res.json(result);
});//close

var server;
if (config.https) { //with ssl
    server = https.createServer(
        {
            key: fs.readFileSync(config.sslKeyPath),
            cert: fs.readFileSync(config.sslCertPath)
        },
        app).listen(config.port, '0.0.0.0');
    console.log("Https server running on port " + config.port + " (engine " + config.engine + ")");
} else { //http
    server = app.listen(config.port, '0.0.0.0', () => {
        console.log("Http server running on port " + config.port + " (engine " + config.engine + ")");
    });
}//http

var shuttingDown = false;
async function shutdown(signal, exitCode = 0) {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(signal + ': fechando sessões...');
    server.close();
    await Promise.all(Sessions.getSessions().map(session => Sessions.closeSession(session.name)));
    process.exit(exitCode);
} //shutdown

// SIGTERM: docker stop / kill; SIGINT: ctrl+c; SIGUSR2: nodemon restart
['SIGTERM', 'SIGINT', 'SIGUSR2'].forEach(signal => process.on(signal, () => shutdown(signal)));
process.on('uncaughtException', error => {
    console.error(error);
    shutdown('uncaughtException', 1);
});
process.on('unhandledRejection', error => {
    console.error('unhandledRejection:', error);
});
