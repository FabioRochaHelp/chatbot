export type Role = 'admin' | 'agent' | 'integration';

export type User = {
    id: number;
    email: string;
    name: string;
    role: 'admin' | 'agent';
    active: boolean;
    lastLoginAt: string | null;
    createdAt: string;
};

export type Principal = { type: 'master' | 'apikey' | 'user' | 'open'; role: Role; user: User | null };

export type AuthStatus = { authRequired: boolean; setupRequired: boolean; principal: Principal | null };

export type SessionState = 'STARTING' | 'QRCODE' | 'CONNECTED' | 'CLOSED' | (string & {});

export type Session = {
    name: string;
    state: SessionState;
    engine: string | null;
    autoStart: boolean | null;
    botMode: string;
    hasQrcode: boolean;
    createdAt: string | null;
    updatedAt: string | null;
};

export type Stats = {
    sessions: { total: number; connected: number };
    conversations: { bot: number; pending: number; open: number };
    unread: number;
    messagesToday: { in: number; out: number };
    messagesByDay: { date: string; in: number; out: number }[];
};

export type Message = {
    id: number;
    conversationId: number;
    direction: 'in' | 'out';
    origin: string;
    type: string;
    body: string | null;
    caption: string | null;
    timestamp: string;
};
