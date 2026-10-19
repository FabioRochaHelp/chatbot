export type Role = 'admin' | 'agent' | 'integration';

export type User = {
    id: number;
    email: string;
    name: string;
    role: 'admin' | 'agent';
    active: boolean;
    // "Disponível": recebe conversas dos departamentos distribuídos
    available: boolean;
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
    flow: { id: number; name: string; version: number } | null;
    aiAgent: { id: number; name: string; model: string } | null;
    acceptGroups: boolean;
    hasQrcode: boolean;
    createdAt: string | null;
    updatedAt: string | null;
};

export type Stats = {
    sessions: { total: number; connected: number };
    conversations: { bot: number; pending: number; open: number };
    // fila por departamento (null = "Sem departamento"), no escopo do usuário
    queues: { departmentId: number | null; pending: number; oldestQueuedAt: string | null }[];
    unread: number;
    messagesToday: { in: number; out: number };
    messagesByDay: { date: string; in: number; out: number }[];
};

export type Message = {
    id: number;
    conversationId: number;
    direction: 'in' | 'out' | 'note';
    origin: 'contact' | 'phone' | 'api' | 'bot' | 'agent' | (string & {});
    type: string;
    body: string | null;
    caption: string | null;
    author: string | null;
    mediaPath: string | null;
    mimeType: string | null;
    fileName: string | null;
    payload: {
        lat?: number;
        lng?: number;
        name?: string | null;
        url?: string;
        vcard?: string;
        contact?: string;
        // grupos: nome de quem escreveu
        authorName?: string;
    } | null;
    sentBy: { id: number; name: string } | null;
    timestamp: string;
};

export type Contact = {
    id: number;
    waId: string;
    name: string | null;
    pushName: string | null;
    isGroup: boolean;
    tags: string[];
    avatarPath: string | null;
    avatarCheckedAt: string | null;
    createdAt: string;
};

export type ConversationStatus = 'bot' | 'pending' | 'open' | 'closed';

export type Conversation = {
    id: number;
    session: string;
    sessionId: number;
    status: ConversationStatus;
    assignedUserId: number | null;
    assignedUser: { id: number; name: string } | null;
    unreadCount: number;
    lastMessageAt: string;
    createdAt: string;
    closedAt: string | null;
    departmentId: number | null;
    department: { id: number; name: string; mode: DepartmentMode } | null;
    queuedAt: string | null;
    contact: Contact;
    lastMessage: Message | null;
};

// esteira: o atendente escolhe na fila; distribuida: rodízio entre os disponíveis
export type DepartmentMode = 'esteira' | 'distribuida';

export type DepartmentMember = {
    id: number;
    name: string;
    role: 'admin' | 'agent';
    active: boolean;
    available: boolean;
    // painel aberto e disponível
    online: boolean;
    lastAssignedAt: string | null;
};

export type Department = {
    id: number;
    name: string;
    mode: DepartmentMode;
    active: boolean;
    pending: number;
    // o usuário é atendente do departamento
    mine: boolean;
    members: DepartmentMember[];
};

export type DirectoryUser = { id: number; name: string; role: 'admin' | 'agent' };

export type QuickReply = { id: number; shortcut: string; text: string };

export type ApiKey = {
    id: number;
    name: string;
    prefix: string;
    createdBy: { name: string } | null;
    lastUsedAt: string | null;
    revokedAt: string | null;
    createdAt: string;
    key?: string;
};
