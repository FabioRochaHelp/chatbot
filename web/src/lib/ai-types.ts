export type AiModel = { id: string; label: string; input: number; output: number };
export type AiStatus = { available: boolean; defaultModel: string; models: AiModel[] };

export type AiUsageSummary = {
    replies: number;
    handoffs: number;
    errors: number;
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    cacheWriteTokens: number;
    costUsd: number;
};

export type AiAgent = {
    id: number;
    name: string;
    model: string;
    effort: 'low' | 'medium' | 'high';
    instructions: string;
    knowledge: string;
    historyMessages: number;
    maxRepliesPerHour: number;
    updatedAt: string;
    sessions: string[];
    usage: AiUsageSummary;
};

export const EFFORTS: { value: AiAgent['effort']; label: string; description: string }[] = [
    {
        value: 'low',
        label: 'Rápido',
        description: 'Respostas imediatas e mais baratas. Bom para dúvidas do dia a dia.'
    },
    { value: 'medium', label: 'Equilibrado', description: 'Pensa um pouco mais antes de responder.' },
    { value: 'high', label: 'Caprichado', description: 'Mais cuidadoso em casos complexos; mais lento e caro.' }
];

const usd = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 });
export const formatUsd = (value: number) => usd.format(value);
