import {
    Clock,
    Flag,
    GitBranch,
    Globe,
    Headset,
    ListOrdered,
    MessageCircleQuestion,
    MessageSquareText,
    Play,
    Sparkles,
    Tag,
    Timer,
    type LucideIcon
} from 'lucide-react';

export type FlowNodeType =
    | 'start'
    | 'message'
    | 'menu'
    | 'question'
    | 'condition'
    | 'businessHours'
    | 'delay'
    | 'http'
    | 'tag'
    | 'handoff'
    | 'ai'
    | 'end';

export type MenuOption = { id: string; label: string };
export type Rule = {
    id: string;
    variable: string;
    operator: 'equals' | 'contains' | 'startsWith' | 'regex' | 'exists';
    value: string;
};
export type Slot = { days: number[]; start: string; end: string };

export type FlowNodeData = {
    text?: string;
    options?: MenuOption[];
    variable?: string;
    invalidText?: string;
    maxAttempts?: number;
    validation?: 'any' | 'number' | 'email' | 'phone';
    rules?: Rule[];
    timezone?: string;
    schedule?: Slot[];
    seconds?: number;
    method?: 'GET' | 'POST' | 'PUT';
    url?: string;
    body?: string;
    saveAs?: string;
    tag?: string;
    close?: boolean;
    agentId?: number;
    agentName?: string;
};

export type FlowSettings = { timeoutMinutes?: number; handoffKeywords?: string[]; handoffText?: string };

export type FlowDefinition = {
    nodes: { id: string; type: FlowNodeType; position: { x: number; y: number }; data: FlowNodeData }[];
    edges: { id: string; source: string; target: string; sourceHandle?: string | null }[];
    settings: FlowSettings;
};

export type FlowSummary = {
    id: number;
    name: string;
    description: string | null;
    version: number;
    publishedAt: string | null;
    updatedAt: string;
    draftChanged: boolean;
    sessions: string[];
};

export type Flow = FlowSummary & { definition: FlowDefinition; published: FlowDefinition | null };

export type Issue = { nodeId?: string; message: string };

export const newId = () => crypto.randomUUID().slice(0, 8);

type Meta = {
    label: string;
    description: string;
    icon: LucideIcon;
    /** cor do ícone: só identifica o tipo, nunca é o único sinal (sempre há rótulo) */
    tone: string;
    create: () => FlowNodeData;
    /** saídas: null = saída única */
    outputs: (data: FlowNodeData) => { id: string | null; label?: string }[];
};

export const NODE_META: Record<FlowNodeType, Meta> = {
    start: {
        label: 'Início',
        description: 'Primeira mensagem do contato.',
        icon: Play,
        tone: 'text-primary',
        create: () => ({}),
        outputs: () => [{ id: null }]
    },
    message: {
        label: 'Mensagem',
        description: 'Envia um texto e segue.',
        icon: MessageSquareText,
        tone: 'text-info',
        create: () => ({ text: '' }),
        outputs: () => [{ id: null }]
    },
    menu: {
        label: 'Menu',
        description: 'Opções numeradas; cada uma segue um caminho.',
        icon: ListOrdered,
        tone: 'text-info',
        create: () => ({
            text: 'Como podemos ajudar?',
            options: [
                { id: newId(), label: 'Opção 1' },
                { id: newId(), label: 'Opção 2' }
            ]
        }),
        outputs: data => [
            ...(data.options ?? []).map((option, index) => ({
                id: option.id,
                label: `${index + 1}. ${option.label || '…'}`
            })),
            { id: 'invalid', label: 'Não entendeu (3x)' }
        ]
    },
    question: {
        label: 'Pergunta',
        description: 'Espera a resposta e guarda numa variável.',
        icon: MessageCircleQuestion,
        tone: 'text-info',
        create: () => ({ text: '', variable: '', validation: 'any' }),
        outputs: () => [{ id: null }]
    },
    condition: {
        label: 'Condição',
        description: 'Escolhe o caminho pela mensagem ou variável.',
        icon: GitBranch,
        tone: 'text-warning',
        create: () => ({ rules: [{ id: newId(), variable: 'message', operator: 'contains', value: '' }] }),
        outputs: data => [
            ...(data.rules ?? []).map((rule, index) => ({ id: rule.id, label: `Se ${index + 1}` })),
            { id: 'else', label: 'Senão' }
        ]
    },
    businessHours: {
        label: 'Horário',
        description: 'Separa dentro e fora do horário de atendimento.',
        icon: Clock,
        tone: 'text-warning',
        create: () => ({
            timezone: 'America/Sao_Paulo',
            schedule: [{ days: [1, 2, 3, 4, 5], start: '08:00', end: '18:00' }]
        }),
        outputs: () => [
            { id: 'open', label: 'Aberto' },
            { id: 'closed', label: 'Fechado' }
        ]
    },
    delay: {
        label: 'Aguardar',
        description: 'Pausa de alguns segundos (até 30).',
        icon: Timer,
        tone: 'text-muted-foreground',
        create: () => ({ seconds: 2 }),
        outputs: () => [{ id: null }]
    },
    http: {
        label: 'Requisição HTTP',
        description: 'Consulta outro sistema e guarda a resposta.',
        icon: Globe,
        tone: 'text-muted-foreground',
        create: () => ({ method: 'GET', url: 'https://', saveAs: 'resposta' }),
        outputs: () => [
            { id: 'success', label: 'Sucesso' },
            { id: 'error', label: 'Erro' }
        ]
    },
    tag: {
        label: 'Etiqueta',
        description: 'Adiciona uma etiqueta ao contato.',
        icon: Tag,
        tone: 'text-muted-foreground',
        create: () => ({ tag: '' }),
        outputs: () => [{ id: null }]
    },
    handoff: {
        label: 'Transferir',
        description: 'Passa para a fila de atendentes.',
        icon: Headset,
        tone: 'text-primary',
        create: () => ({ text: 'Vou te passar para um atendente.' }),
        outputs: () => []
    },
    ai: {
        label: 'IA',
        description: 'Um assistente de IA continua a conversa a partir daqui.',
        icon: Sparkles,
        tone: 'text-primary',
        create: () => ({}),
        outputs: () => []
    },
    end: {
        label: 'Fim',
        description: 'Termina o fluxo (opcionalmente encerra a conversa).',
        icon: Flag,
        tone: 'text-muted-foreground',
        create: () => ({ close: false }),
        outputs: () => []
    }
};

export const PALETTE: FlowNodeType[] = [
    'message',
    'menu',
    'question',
    'condition',
    'businessHours',
    'delay',
    'http',
    'tag',
    'ai',
    'handoff',
    'end'
];

export const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];

/** Resumo curto do bloco para o cartão no canvas. */
export function nodeSummary(type: FlowNodeType, data: FlowNodeData): string {
    switch (type) {
        case 'start':
            return 'Quando o contato manda mensagem';
        case 'message':
        case 'handoff':
            return data.text || (type === 'handoff' ? 'Sem mensagem' : '');
        case 'menu':
            return data.text || '';
        case 'question':
            return data.text ? `${data.text}${data.variable ? ` → {{${data.variable}}}` : ''}` : '';
        case 'condition':
            return '';
        case 'businessHours':
            return (data.schedule ?? [])
                .map(slot => `${slot.days.map(day => WEEKDAYS[day]).join(', ')} ${slot.start}–${slot.end}`)
                .join(' · ');
        case 'delay':
            return `${data.seconds ?? 1} s`;
        case 'http':
            return `${data.method ?? 'GET'} ${data.url ?? ''}`;
        case 'tag':
            return data.tag ? `#${data.tag}` : '';
        case 'ai':
            return data.agentName ? `Assistente: ${data.agentName}` : '';
        case 'end':
            return (
                [data.text, data.close ? 'Encerra a conversa' : ''].filter(Boolean).join(' · ') ||
                'Aguarda a próxima mensagem'
            );
    }
}
