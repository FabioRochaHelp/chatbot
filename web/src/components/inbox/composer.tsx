import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Paperclip, SendHorizontal, StickyNote, X, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { useQuickReplies } from '@/lib/queries';
import { upsertMessage } from '@/lib/thread';
import type { Conversation, Message } from '@/lib/types';
import { cn, fileToDataUrl } from '@/lib/utils';

const MAX_FILE_MB = 15;

type Mode = 'reply' | 'note';

export function Composer({ conversation, connected }: { conversation: Conversation; connected: boolean }) {
    const queryClient = useQueryClient();
    const [mode, setMode] = useState<Mode>('reply');
    const [text, setText] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [highlight, setHighlight] = useState(0);
    const textarea = useRef<HTMLTextAreaElement>(null);
    const fileInput = useRef<HTMLInputElement>(null);
    const { data: quickReplies } = useQuickReplies();

    // "/atalho" no começo abre as respostas rápidas
    const slash = mode === 'reply' && /^\/\S*$/.test(text) ? text.slice(1).toLowerCase() : null;
    const suggestions = useMemo(
        () => (slash === null ? [] : (quickReplies ?? []).filter(reply => reply.shortcut.includes(slash)).slice(0, 6)),
        [slash, quickReplies]
    );

    // altura automática (até ~6 linhas)
    useEffect(() => {
        const element = textarea.current;
        if (!element) return;
        element.style.height = 'auto';
        element.style.height = Math.min(element.scrollHeight, 160) + 'px';
    }, [text]);

    const send = useMutation({
        mutationFn: async () => {
            const base = '/conversations/' + conversation.id;
            if (mode === 'note') return api.post<Message>(base + '/notes', { text });
            if (file) {
                return api.post<Message>(base + '/messages', {
                    type: 'file',
                    base64: await fileToDataUrl(file),
                    fileName: file.name,
                    caption: text || undefined
                });
            }
            return api.post<Message>(base + '/messages', { type: 'text', text });
        },
        onSuccess: message => {
            if (message) upsertMessage(queryClient, message);
            queryClient.invalidateQueries({ queryKey: ['conversation', conversation.id] });
            setText('');
            setFile(null);
            textarea.current?.focus();
        },
        onError: error => toast.error(error instanceof ApiError ? error.message : 'Não foi possível enviar.')
    });

    const blockedReply = mode === 'reply' && !connected;
    const canSend = !send.isPending && !blockedReply && (text.trim().length > 0 || (mode === 'reply' && file));

    const pick = (value: string) => {
        setText(value);
        setHighlight(0);
        textarea.current?.focus();
    };

    const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
        if (suggestions.length > 0) {
            if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
                event.preventDefault();
                const step = event.key === 'ArrowDown' ? 1 : -1;
                setHighlight(current => (current + step + suggestions.length) % suggestions.length);
                return;
            }
            if (event.key === 'Enter' || event.key === 'Tab') {
                event.preventDefault();
                pick(suggestions[Math.min(highlight, suggestions.length - 1)].text);
                return;
            }
        }
        if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) {
            event.preventDefault();
            if (canSend) send.mutate();
        }
    };

    return (
        <div className="border-t bg-card px-3 pt-2 pb-3 sm:px-4">
            <div className="mb-2 flex items-center gap-1" role="tablist" aria-label="Tipo de mensagem">
                {(
                    [
                        ['reply', 'Responder', SendHorizontal],
                        ['note', 'Nota interna', StickyNote]
                    ] as const
                ).map(([value, label, Icon]) => (
                    <button
                        key={value}
                        type="button"
                        role="tab"
                        aria-selected={mode === value}
                        onClick={() => setMode(value)}
                        className={cn(
                            'flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground',
                            mode === value &&
                                (value === 'note' ? 'bg-warning-soft text-warning' : 'bg-muted text-foreground')
                        )}
                    >
                        <Icon className="size-3.5" aria-hidden />
                        {label}
                    </button>
                ))}
                {mode === 'reply' && (
                    <span className="ml-auto hidden text-xs text-muted-foreground sm:block">
                        <kbd className="font-sans">/</kbd> respostas rápidas ·{' '}
                        <kbd className="font-sans">Shift+Enter</kbd> nova linha
                    </span>
                )}
            </div>

            {blockedReply && (
                <p className="mb-2 rounded-lg bg-warning-soft px-3 py-2 text-[13px] text-warning" role="status">
                    A sessão “{conversation.session}” não está conectada. Dá para escrever notas internas, mas as
                    respostas só saem quando ela reconectar.
                </p>
            )}

            <div className="relative">
                {suggestions.length > 0 && (
                    <ul
                        className="absolute bottom-full left-0 z-20 mb-2 w-full max-w-md overflow-hidden rounded-xl border bg-card p-1 shadow-lg"
                        role="listbox"
                        aria-label="Respostas rápidas"
                    >
                        {suggestions.map((reply, index) => (
                            <li key={reply.id} role="option" aria-selected={index === highlight}>
                                <button
                                    type="button"
                                    onMouseDown={event => event.preventDefault()}
                                    onClick={() => pick(reply.text)}
                                    className={cn(
                                        'flex w-full items-start gap-2 rounded-lg px-2.5 py-2 text-left text-sm',
                                        index === highlight && 'bg-muted'
                                    )}
                                >
                                    <Zap className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden />
                                    <span className="min-w-0">
                                        <span className="font-medium">/{reply.shortcut}</span>
                                        <span className="block truncate text-muted-foreground">{reply.text}</span>
                                    </span>
                                </button>
                            </li>
                        ))}
                    </ul>
                )}

                {file && mode === 'reply' && (
                    <div className="mb-2 flex items-center gap-2 rounded-lg bg-muted px-3 py-1.5 text-sm">
                        <Paperclip className="size-4 text-muted-foreground" aria-hidden />
                        <span className="min-w-0 flex-1 truncate">{file.name}</span>
                        <button
                            type="button"
                            onClick={() => setFile(null)}
                            aria-label="Remover anexo"
                            className="rounded p-0.5 hover:bg-card"
                        >
                            <X className="size-4" />
                        </button>
                    </div>
                )}

                <div
                    className={cn(
                        'flex items-end gap-2 rounded-xl border bg-background p-1.5 focus-within:border-primary focus-within:ring-3 focus-within:ring-ring',
                        mode === 'note' && 'border-warning/40 bg-warning-soft/50 focus-within:border-warning'
                    )}
                >
                    {mode === 'reply' && (
                        <>
                            <input
                                ref={fileInput}
                                type="file"
                                className="hidden"
                                onChange={event => {
                                    const chosen = event.target.files?.[0] ?? null;
                                    event.target.value = '';
                                    if (chosen && chosen.size > MAX_FILE_MB * 1024 * 1024) {
                                        toast.error(`O arquivo passa de ${MAX_FILE_MB} MB.`);
                                        return;
                                    }
                                    setFile(chosen);
                                }}
                            />
                            <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="size-8"
                                onClick={() => fileInput.current?.click()}
                                aria-label="Anexar arquivo"
                                title="Anexar arquivo"
                            >
                                <Paperclip />
                            </Button>
                        </>
                    )}
                    <textarea
                        ref={textarea}
                        rows={1}
                        value={text}
                        onChange={event => {
                            setText(event.target.value);
                            setHighlight(0);
                        }}
                        onKeyDown={onKeyDown}
                        placeholder={
                            mode === 'note'
                                ? 'Nota visível só para a equipe…'
                                : file
                                  ? 'Legenda (opcional)…'
                                  : 'Escreva uma mensagem…'
                        }
                        aria-label={mode === 'note' ? 'Nota interna' : 'Mensagem'}
                        className="max-h-40 min-h-8 flex-1 resize-none bg-transparent px-1.5 py-1.5 text-sm outline-none placeholder:text-muted-foreground/70"
                    />
                    <Button
                        type="button"
                        size="icon"
                        className="size-8"
                        variant={mode === 'note' ? 'outline' : 'default'}
                        disabled={!canSend}
                        loading={send.isPending}
                        onClick={() => send.mutate()}
                        aria-label={mode === 'note' ? 'Salvar nota' : 'Enviar'}
                        title={mode === 'note' ? 'Salvar nota' : 'Enviar'}
                    >
                        {!send.isPending && (mode === 'note' ? <StickyNote /> : <SendHorizontal />)}
                    </Button>
                </div>
            </div>
        </div>
    );
}
