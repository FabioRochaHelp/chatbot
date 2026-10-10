import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import type { Session } from '@/lib/types';
import { formatNumber } from '@/lib/utils';

type Deleted = { loggedOut: boolean; conversations: number; messages: number };

/** Excluir sessão: apaga login, conversas e mídias; pede o nome digitado para confirmar. */
export function DeleteSession({ session }: { session: Session }) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [open, setOpen] = useState(false);
    const [typed, setTyped] = useState('');
    const connected = session.state === 'CONNECTED';

    const remove = useMutation({
        mutationFn: () => api.delete<Deleted>('/sessions/' + encodeURIComponent(session.name)),
        onSuccess: result => {
            queryClient.removeQueries({ queryKey: ['sessions', session.name] });
            queryClient.invalidateQueries({ queryKey: ['sessions'] });
            queryClient.invalidateQueries({ queryKey: ['conversations'] });
            queryClient.invalidateQueries({ queryKey: ['stats'] });
            toast.success(`Sessão “${session.name}” excluída`, {
                description:
                    `${formatNumber(result.conversations)} conversas e ${formatNumber(result.messages)} mensagens apagadas.` +
                    (connected && !result.loggedOut
                        ? ' Não foi possível desconectar o aparelho: remova-o em Aparelhos conectados no celular.'
                        : '')
            });
            navigate('/sessions', { replace: true });
        },
        onError: error => toast.error(error instanceof ApiError ? error.message : 'Não foi possível excluir.')
    });

    const matches = typed.trim() === session.name;
    const submit = (event: FormEvent) => {
        event.preventDefault();
        if (matches) remove.mutate();
    };

    return (
        <div className="border-t pt-4">
            <Button
                variant="ghost"
                className="w-full text-destructive hover:bg-destructive-soft hover:text-destructive"
                onClick={() => setOpen(true)}
            >
                <Trash2 /> Excluir sessão
            </Button>
            <Dialog
                open={open}
                onOpenChange={next => {
                    setOpen(next);
                    if (!next) {
                        setTyped('');
                        remove.reset();
                    }
                }}
            >
                <DialogContent title={`Excluir a sessão “${session.name}”?`} description="Não dá para desfazer.">
                    <form className="grid gap-4" onSubmit={submit}>
                        <ul className="grid list-disc gap-1.5 pl-5 text-sm text-muted-foreground marker:text-destructive">
                            {connected && (
                                <li>O número é desconectado do WhatsApp (sai de Aparelhos conectados no celular).</li>
                            )}
                            <li>O login é apagado: para usar o número de novo, será preciso ler o QR code.</li>
                            <li>
                                Todas as conversas, contatos, mensagens, mídias e webhooks desta sessão são apagados.
                            </li>
                            <li>Fluxos, assistentes de IA, usuários e chaves de API continuam.</li>
                        </ul>
                        <p className="rounded-lg bg-muted px-3 py-2 text-[13px] text-muted-foreground">
                            Quer guardar o histórico? Faça um backup antes (<code>make backup</code>; no Docker,{' '}
                            <code>make docker-backup</code>).
                        </p>
                        <Field
                            label={
                                <>
                                    Digite <strong className="font-semibold">{session.name}</strong> para confirmar
                                </>
                            }
                        >
                            <Input
                                value={typed}
                                onChange={event => setTyped(event.target.value)}
                                autoComplete="off"
                                spellCheck={false}
                                autoFocus
                            />
                        </Field>
                        <div className="flex justify-end gap-2">
                            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit" variant="destructive" disabled={!matches} loading={remove.isPending}>
                                Excluir sessão
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            </Dialog>
        </div>
    );
}
