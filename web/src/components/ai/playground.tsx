import { useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCheck, Headset, RotateCcw, SendHorizontal } from 'lucide-react';
import { RichText } from '@/components/inbox/rich-text';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { formatUsd, type AiAgent } from '@/lib/ai-types';
import { cn, formatNumber } from '@/lib/utils';

type Effect = { type: 'handoff' | 'end'; note?: string };
type TestResult = {
    replies: string[];
    effects: Effect[];
    outcome: string;
    usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; costUsd: number };
};
type Entry =
    | { kind: 'in' | 'out'; text: string }
    | { kind: 'effect'; effect: Effect }
    | { kind: 'cost'; usage: TestResult['usage'] };

export function Playground({
    agent,
    disabled
}: {
    agent: Pick<AiAgent, 'id' | 'model' | 'effort' | 'instructions' | 'knowledge'>;
    disabled?: string;
}) {
    const [entries, setEntries] = useState<Entry[]>([]);
    const [input, setInput] = useState('');
    const [total, setTotal] = useState(0);
    const log = useRef<HTMLDivElement>(null);

    const conversation = () =>
        entries.flatMap(entry =>
            entry.kind === 'in' || entry.kind === 'out' ? [{ direction: entry.kind, body: entry.text }] : []
        );

    const send = useMutation({
        mutationFn: (messages: { direction: 'in' | 'out'; body: string }[]) =>
            api.post<TestResult>('/ai-agents/test', {
                agentId: agent.id,
                agent: {
                    model: agent.model,
                    effort: agent.effort,
                    instructions: agent.instructions,
                    knowledge: agent.knowledge
                },
                contactName: 'Maria',
                messages
            }),
        onSuccess: result => {
            setTotal(value => value + result.usage.costUsd);
            setEntries(current => [
                ...current,
                ...result.replies.map(text => ({ kind: 'out' as const, text })),
                ...result.effects.map(effect => ({ kind: 'effect' as const, effect })),
                { kind: 'cost', usage: result.usage }
            ]);
            requestAnimationFrame(() => log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }));
        }
    });

    const submit = (event: FormEvent) => {
        event.preventDefault();
        const text = input.trim();
        if (!text || send.isPending) return;
        setEntries(current => [...current, { kind: 'in', text }]);
        setInput('');
        send.mutate([...conversation(), { direction: 'in', body: text }]);
    };

    return (
        <Card className="flex h-[min(640px,calc(100dvh-10rem))] flex-col">
            <CardHeader className="flex-row items-start justify-between gap-2">
                <div>
                    <CardTitle>Testar</CardTitle>
                    <CardDescription>
                        Usa a configuração atual, mesmo sem salvar. Chama a IA de verdade (custo real).
                    </CardDescription>
                </div>
                <Button
                    variant="ghost"
                    size="sm"
                    disabled={entries.length === 0}
                    onClick={() => {
                        setEntries([]);
                        setTotal(0);
                        send.reset();
                    }}
                >
                    <RotateCcw /> Reiniciar
                </Button>
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col gap-3 pt-3">
                <div
                    ref={log}
                    className="grid min-h-0 flex-1 content-start gap-1.5 overflow-y-auto rounded-lg bg-muted/50 p-3"
                    role="log"
                    aria-live="polite"
                >
                    {entries.length === 0 && (
                        <p className="px-4 py-10 text-center text-[13px] text-muted-foreground">
                            Mande uma pergunta como se fosse um cliente. Teste também pedidos que devem ir para um
                            atendente.
                        </p>
                    )}
                    {entries.map((entry, index) => {
                        if (entry.kind === 'cost') {
                            return (
                                <p key={index} className="text-right text-[11px] text-muted-foreground tabular-nums">
                                    {formatNumber(entry.usage.inputTokens + entry.usage.cacheReadTokens)} tokens de
                                    entrada
                                    {entry.usage.cacheReadTokens > 0 &&
                                        ` (${formatNumber(entry.usage.cacheReadTokens)} do cache)`}{' '}
                                    · {formatNumber(entry.usage.outputTokens)} de saída ·{' '}
                                    {formatUsd(entry.usage.costUsd)}
                                </p>
                            );
                        }
                        if (entry.kind === 'effect') {
                            const Icon = entry.effect.type === 'handoff' ? Headset : CheckCheck;
                            return (
                                <div key={index} className="my-1 flex justify-center">
                                    <span className="flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs text-muted-foreground shadow-xs">
                                        <Icon className="size-3.5" aria-hidden />
                                        {entry.effect.type === 'handoff'
                                            ? 'Transferiu para atendente'
                                            : 'Encerrou a conversa'}
                                        {entry.effect.note && `: ${entry.effect.note}`}
                                    </span>
                                </div>
                            );
                        }
                        return (
                            <div
                                key={index}
                                className={cn('flex', entry.kind === 'in' ? 'justify-end' : 'justify-start')}
                            >
                                <p
                                    className={cn(
                                        'max-w-[85%] rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap shadow-xs',
                                        entry.kind === 'in'
                                            ? 'rounded-br-md bg-primary-soft'
                                            : 'rounded-bl-md border bg-card'
                                    )}
                                >
                                    <RichText text={entry.text} />
                                </p>
                            </div>
                        );
                    })}
                    {send.isPending && <p className="text-xs text-muted-foreground">Pensando…</p>}
                    {send.error && (
                        <p className="text-center text-xs text-destructive first-letter:uppercase">
                            {send.error instanceof ApiError ? send.error.message : 'Erro ao testar.'}
                        </p>
                    )}
                </div>
                {total > 0 && (
                    <p className="text-right text-xs text-muted-foreground">Custo deste teste: {formatUsd(total)}</p>
                )}
                <form onSubmit={submit} className="flex gap-2">
                    <Input
                        value={input}
                        onChange={event => setInput(event.target.value)}
                        placeholder={disabled ?? 'Pergunta do cliente…'}
                        disabled={Boolean(disabled)}
                        aria-label="Pergunta do cliente"
                    />
                    <Button
                        type="submit"
                        size="icon"
                        loading={send.isPending}
                        disabled={!input.trim() || Boolean(disabled)}
                        aria-label="Enviar"
                    >
                        {!send.isPending && <SendHorizontal />}
                    </Button>
                </form>
            </CardContent>
        </Card>
    );
}
