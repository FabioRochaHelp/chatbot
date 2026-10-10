export type WebhookEvent =
    'message.received' | 'message.sent' | 'conversation.updated' | 'conversation.handoff' | 'session.state';

export type Webhook = {
    id: number;
    url: string;
    session: string | null;
    events: WebhookEvent[];
    active: boolean;
    legacy: boolean;
    hasSecret: boolean;
    secret?: string;
    createdAt: string;
    lastDelivery: {
        id: number;
        event: string;
        status: DeliveryStatus;
        lastStatus: number | null;
        createdAt: string;
    } | null;
    failedDeliveries: number;
};

export type DeliveryStatus = 'pending' | 'success' | 'failed';

export type Delivery = {
    id: number;
    event: string;
    payload: unknown;
    status: DeliveryStatus;
    attempts: number;
    nextAttemptAt: string;
    lastStatus: number | null;
    lastError: string | null;
    durationMs: number | null;
    createdAt: string;
    deliveredAt: string | null;
};

export const EVENT_INFO: Record<WebhookEvent, { label: string; description: string }> = {
    'message.received': { label: 'Mensagem recebida', description: 'Toda mensagem que chega de um contato.' },
    'message.sent': { label: 'Mensagem enviada', description: 'Enviada pela API, bot, IA, atendente ou pelo celular.' },
    'conversation.updated': {
        label: 'Conversa alterada',
        description: 'Mudou de status, foi assumida, transferida ou encerrada.'
    },
    'conversation.handoff': {
        label: 'Transferência para a fila',
        description: 'O bot ou a IA passou a conversa para atendentes.'
    },
    'session.state': { label: 'Status da sessão', description: 'Conectou, caiu, pediu QR code…' }
};

export const EVENTS = Object.keys(EVENT_INFO) as WebhookEvent[];
