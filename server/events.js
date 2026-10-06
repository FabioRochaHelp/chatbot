'use strict';

const { EventEmitter } = require('events');

/**
 * Barramento interno. Eventos:
 * - message.saved     { session, message, conversation, contact }
 * - message.updated   { session, message } (ex.: mídia baixada)
 * - conversation.updated / contact.updated / user.revoked
 * - session.state     { session, state }
 * - session.qrcode    { session, qrcode }
 */
const events = new EventEmitter();
events.setMaxListeners(50);

module.exports = events;
