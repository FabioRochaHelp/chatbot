import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api';
import { useQuickReplies } from '@/lib/queries';
import type { QuickReply } from '@/lib/types';

function ReplyDialog({
    reply,
    open,
    onOpenChange
}: {
    reply: QuickReply | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const queryClient = useQueryClient();
    const [form, setForm] = useState({ shortcut: '', text: '' });
    const [seed, setSeed] = useState<QuickReply | null | undefined>(undefined);
    if (open && seed !== reply) {
        setSeed(reply);
        setForm(reply ? { shortcut: reply.shortcut, text: reply.text } : { shortcut: '', text: '' });
    }
    const save = useMutation({
        mutationFn: () => (reply ? api.patch('/quick-replies/' + reply.id, form) : api.post('/quick-replies', form)),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['quick-replies'] });
            onOpenChange(false);
        }
    });
    const error = save.error instanceof ApiError ? save.error : null;
    const fields = error?.fieldErrors ?? {};

    return (
        <Dialog
            open={open}
            onOpenChange={next => {
                onOpenChange(next);
                if (!next) {
                    save.reset();
                    setSeed(undefined);
                }
            }}
        >
            <DialogContent
                title={reply ? 'Editar resposta rápida' : 'Nova resposta rápida'}
                description="No chat, digite / e o atalho para usar."
            >
                <form
                    className="grid gap-4"
                    onSubmit={(event: FormEvent) => {
                        event.preventDefault();
                        save.mutate();
                    }}
                    noValidate
                >
                    <Field
                        label="Atalho"
                        hint="Ex.: horario, pix, endereco"
                        error={
                            fields.shortcut ||
                            (error?.code === 'SHORTCUT_TAKEN' ? 'Já existe uma resposta com este atalho' : undefined)
                        }
                    >
                        <div className="flex items-center rounded-lg border border-input bg-card focus-within:border-primary focus-within:ring-3 focus-within:ring-ring">
                            <span className="pl-3 text-muted-foreground">/</span>
                            <input
                                value={form.shortcut}
                                onChange={event =>
                                    setForm({ ...form, shortcut: event.target.value.toLowerCase().replace(/\s/g, '-') })
                                }
                                maxLength={30}
                                className="h-9 flex-1 bg-transparent px-1 text-sm outline-none"
                                autoFocus
                            />
                        </div>
                    </Field>
                    <Field label="Texto" hint="Aceita *negrito* e _itálico_ do WhatsApp." error={fields.text}>
                        <Textarea
                            value={form.text}
                            onChange={event => setForm({ ...form, text: event.target.value })}
                            rows={5}
                        />
                    </Field>
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit" loading={save.isPending}>
                            Salvar
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export function QuickRepliesSettings() {
    const queryClient = useQueryClient();
    const { data: replies, isLoading } = useQuickReplies();
    const [editing, setEditing] = useState<QuickReply | null>(null);
    const [open, setOpen] = useState(false);
    const remove = useMutation({
        mutationFn: (reply: QuickReply) => api.delete('/quick-replies/' + reply.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['quick-replies'] });
            toast.success('Resposta removida');
        }
    });

    return (
        <section className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                    Textos prontos para os atendentes. No chat, digite / para ver a lista.
                </p>
                <Button
                    onClick={() => {
                        setEditing(null);
                        setOpen(true);
                    }}
                >
                    <Plus /> Nova resposta
                </Button>
            </div>
            {isLoading ? (
                <Skeleton className="h-32 rounded-xl" />
            ) : replies && replies.length > 0 ? (
                <ul className="divide-y rounded-xl border bg-card">
                    {replies.map(reply => (
                        <li key={reply.id} className="flex items-start gap-3 px-4 py-3">
                            <div className="min-w-0 flex-1">
                                <p className="text-sm font-medium">/{reply.shortcut}</p>
                                <p className="line-clamp-2 text-[13px] whitespace-pre-wrap text-muted-foreground">
                                    {reply.text}
                                </p>
                            </div>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Editar /${reply.shortcut}`}
                                onClick={() => {
                                    setEditing(reply);
                                    setOpen(true);
                                }}
                            >
                                <Pencil />
                            </Button>
                            <Button
                                variant="ghost"
                                size="icon"
                                aria-label={`Remover /${reply.shortcut}`}
                                onClick={() => remove.mutate(reply)}
                            >
                                <Trash2 />
                            </Button>
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                    Nenhuma resposta rápida ainda.
                </p>
            )}
            <ReplyDialog reply={editing} open={open} onOpenChange={setOpen} />
        </section>
    );
}
