import { useRef, useState, type FormEvent } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Flag, Headset, RotateCcw, SendHorizontal, Sparkles, Tag, X } from 'lucide-react';
import { RichText } from '@/components/inbox/rich-text';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import type { FlowDefinition } from '@/lib/flow-types';
import { cn } from '@/lib/utils';

type Effect = { type: 'handoff' | 'tag' | 'end' | 'ai'; tag?: string; close?: boolean; reason?: string };
type Result = { replies: string[]; effects: Effect[]; state: { nodeId: string } | null; trace: string[] };
type Entry = { from: 'user' | 'bot'; text: string } | { from: 'system'; effect: Effect };

const REASON: Record<string, string> = {
    keyword: 'palavra-chave',
    'invalid-option': 'respostas inválidas',
    loop: 'laço no fluxo',
    flow: 'bloco Transferir'
};

function EffectChip({ effect }: { effect: Effect }) {
    const [Icon, text] =
        effect.type === 'ai'
            ? [Sparkles, 'Daqui em diante a IA responde (teste em Assistentes de IA)']
            : effect.type === 'handoff'
              ? [
                    Headset,
                    `Transferido para a fila${effect.reason ? ` (${REASON[effect.reason] ?? effect.reason})` : ''}`
                ]
              : effect.type === 'tag'
                ? [Tag, `Etiqueta adicionada: ${effect.tag}`]
                : [Flag, effect.close ? 'Fim do fluxo · conversa encerrada' : 'Fim do fluxo'];
    return (
        <div className="my-1 flex justify-center">
            <span className="flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs text-muted-foreground shadow-xs">
                <Icon className="size-3.5" aria-hidden /> {text}
            </span>
        </div>
    );
}

export function Simulator({
    definition,
    onTrace,
    onClose
}: {
    definition: FlowDefinition;
    onTrace: (trace: string[], waiting: string | null) => void;
    onClose: () => void;
}) {
    const [entries, setEntries] = useState<Entry[]>([]);
    const [state, setState] = useState<Result['state']>(null);
    const [input, setInput] = useState('');
    const [name, setName] = useState('Maria');
    const log = useRef<HTMLDivElement>(null);

    const send = useMutation({
        mutationFn: (text: string) =>
            api.post<Result>('/flows/simulate', { definition, state, input: text, contact: { name } }),
        onSuccess: result => {
            setState(result.state);
            setEntries(current => [
                ...current,
                ...result.replies.map(text => ({ from: 'bot' as const, text })),
                ...result.effects.map(effect => ({ from: 'system' as const, effect }))
            ]);
            onTrace(result.trace, result.state?.nodeId ?? null);
            requestAnimationFrame(() => log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }));
        }
    });

    const submit = (event: FormEvent) => {
        event.preventDefault();
        const text = input.trim();
        if (!text || send.isPending) return;
        setEntries(current => [...current, { from: 'user', text }]);
        setInput('');
        send.mutate(text);
    };

    const reset = () => {
        setEntries([]);
        setState(null);
        onTrace([], null);
        send.reset();
    };

    return (
        <aside className="flex h-full flex-col bg-card" aria-label="Simulador">
            <div className="flex items-center gap-2 border-b px-4 py-3">
                <h2 className="flex-1 text-sm font-semibold">Testar fluxo</h2>
                <Button variant="ghost" size="sm" onClick={reset} disabled={entries.length === 0}>
                    <RotateCcw /> Reiniciar
                </Button>
                <Button variant="ghost" size="icon" className="size-8" onClick={onClose} aria-label="Fechar simulador">
                    <X />
                </Button>
            </div>
            <div className="flex items-center gap-2 border-b px-4 py-2 text-[13px] text-muted-foreground">
                <label htmlFor="sim-name">Nome do contato</label>
                <Input
                    id="sim-name"
                    value={name}
                    onChange={event => setName(event.target.value)}
                    className="h-7 flex-1"
                />
            </div>
            <div
                ref={log}
                className="grid flex-1 content-start gap-1.5 overflow-y-auto bg-muted/40 p-3"
                role="log"
                aria-live="polite"
            >
                {entries.length === 0 && (
                    <p className="px-4 py-8 text-center text-[13px] text-muted-foreground">
                        Usa o rascunho atual, sem WhatsApp e sem precisar publicar. Mande uma mensagem como se fosse o
                        cliente.
                    </p>
                )}
                {entries.map((entry, index) =>
                    entry.from === 'system' ? (
                        <EffectChip key={index} effect={entry.effect} />
                    ) : (
                        <div
                            key={index}
                            className={cn('flex', entry.from === 'user' ? 'justify-end' : 'justify-start')}
                        >
                            <p
                                className={cn(
                                    'max-w-[85%] rounded-2xl px-3 py-2 text-sm break-words whitespace-pre-wrap shadow-xs',
                                    entry.from === 'user'
                                        ? 'rounded-br-md bg-primary-soft'
                                        : 'rounded-bl-md border bg-card'
                                )}
                            >
                                <RichText text={entry.text} />
                            </p>
                        </div>
                    )
                )}
                {send.error && (
                    <p className="text-center text-xs text-destructive">
                        {send.error instanceof ApiError ? send.error.message : 'Erro ao simular.'}
                    </p>
                )}
            </div>
            <form onSubmit={submit} className="flex gap-2 border-t p-3">
                <Input
                    value={input}
                    onChange={event => setInput(event.target.value)}
                    placeholder="Mensagem do cliente…"
                    aria-label="Mensagem do cliente"
                />
                <Button type="submit" size="icon" loading={send.isPending} disabled={!input.trim()} aria-label="Enviar">
                    {!send.isPending && <SendHorizontal />}
                </Button>
            </form>
        </aside>
    );
}
