'use strict';

const { EventEmitter } = require('events');

/**
 * Barramento interno. Eventos:
 * - message.saved     { session, message, conversation, contact }
 * - session.state     { session, state }
 * - session.qrcode    { session, qrcode }
 */
const events = new EventEmitter();
events.setMaxListeners(50);

module.exports = events;
