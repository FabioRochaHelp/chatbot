'use strict';

/**
 * Erro com status HTTP e código estável para a API v1.
 * legacyMessage é o "message" que as rotas antigas devolvem ({ result: "error", message }).
 */
class AppError extends Error {
    constructor(status, code, message, { details, legacyMessage } = {}) {
        super(message || code);
        this.status = status;
        this.code = code;
        this.details = details;
        this.legacyMessage = legacyMessage || message || code;
    }
}

module.exports = { AppError };
