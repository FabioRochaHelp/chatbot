'use strict';

const config = require('../config');

// interface comum: create(session, options, puppeteerOptions), sendVoice, sendLinkPreview, getAllChatsNewMsg
module.exports = config.engine === 'VENOM' ? require('./venom') : require('./wppconnect');
