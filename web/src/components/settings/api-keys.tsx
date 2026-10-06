import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy, KeyRound, Plus } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api';
import type { ApiKey } from '@/lib/types';
import { relativeTime } from '@/lib/utils';

function CreateKeyDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const queryClient = useQueryClient();
    const [name, setName] = useState('');
    const [copied, setCopied] = useState(false);
    const create = useMutation({
        mutationFn: () => api.post<ApiKey>('/api-keys', { name }),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['api-keys'] })
    });
    const key = create.data?.key;

    const close = (next: boolean) => {
        onOpenChange(next);
        if (!next) {
            setName('');
            setCopied(false);
            create.reset();
        }
    };

    return (
        <Dialog open={open} onOpenChange={close}>
            {key ? (
                <DialogContent
                    title="Chave criada"
                    description="Copie agora: por segurança ela não será mostrada de novo."
                >
                    <div className="flex items-center gap-2 rounded-lg bg-muted p-2 pl-3">
                        <code className="min-w-0 flex-1 truncate text-sm">{key}</code>
                        <Button
                            size="sm"
                            variant="outline"
                            onClick={async () => {
                                await navigator.clipboard.writeText(key);
                                setCopied(true);
                            }}
                        >
                            {copied ? <Check /> : <Copy />} {copied ? 'Copiada' : 'Copiar'}
                        </Button>
                    </div>
                    <p className="text-[13px] text-muted-foreground">
                        Use no cabeçalho <code>Authorization: Bearer &lt;chave&gt;</code> das chamadas à API.
                    </p>
                    <div className="flex justify-end">
                        <Button onClick={() => close(false)}>Pronto</Button>
                    </div>
                </DialogContent>
            ) : (
                <DialogContent
                    title="Nova chave de API"
                    description="Para integrar outro sistema (ERP, CRM, loja virtual) ao MyZap."
                >
                    <form
                        className="grid gap-4"
                        onSubmit={(event: FormEvent) => {
                            event.preventDefault();
                            if (name.trim()) create.mutate();
                        }}
                    >
                        <Field
                            label="Nome"
                            hint="Para identificar onde a chave é usada. Ex.: Loja virtual"
                            error={create.error instanceof ApiError ? create.error.message : undefined}
                        >
                            <Input
                                value={name}
                                onChange={event => setName(event.target.value)}
                                maxLength={100}
                                autoFocus
                            />
                        </Field>
                        <div className="flex justify-end gap-2">
                            <Button type="button" variant="outline" onClick={() => close(false)}>
                                Cancelar
                            </Button>
                            <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
                                Criar chave
                            </Button>
                        </div>
                    </form>
                </DialogContent>
            )}
        </Dialog>
    );
}

export function ApiKeysSettings() {
    const queryClient = useQueryClient();
    const { data: keys, isLoading } = useQuery({
        queryKey: ['api-keys'],
        queryFn: () => api.get<ApiKey[]>('/api-keys')
    });
    const [createOpen, setCreateOpen] = useState(false);
    const [revoking, setRevoking] = useState<ApiKey | null>(null);
    const revoke = useMutation({
        mutationFn: (key: ApiKey) => api.delete('/api-keys/' + key.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['api-keys'] });
            toast.success('Chave revogada');
            setRevoking(null);
        }
    });

    return (
        <section className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                    Chaves para outros sistemas usarem a API. Não acessam usuários nem chaves.
                </p>
                <Button onClick={() => setCreateOpen(true)}>
                    <Plus /> Nova chave
                </Button>
            </div>
            {isLoading ? (
                <Skeleton className="h-32 rounded-xl" />
            ) : keys && keys.length > 0 ? (
                <ul className="divide-y rounded-xl border bg-card">
                    {keys.map(key => (
                        <li key={key.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                            <KeyRound className="size-4 text-muted-foreground" aria-hidden />
                            <div className="min-w-0 flex-1">
                                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                                    {key.name}
                                    {key.revokedAt && <Badge tone="danger">Revogada</Badge>}
                                </p>
                                <p className="text-[13px] text-muted-foreground">
                                    <code>{key.prefix}…</code> · criada {relativeTime(key.createdAt)}
                                    {key.createdBy && ` por ${key.createdBy.name}`} ·{' '}
                                    {key.lastUsedAt ? `usada ${relativeTime(key.lastUsedAt)}` : 'nunca usada'}
                                </p>
                            </div>
                            {!key.revokedAt && (
                                <Button
                                    variant="outline"
                                    size="sm"
                                    className="text-destructive"
                                    onClick={() => setRevoking(key)}
                                >
                                    Revogar
                                </Button>
                            )}
                        </li>
                    ))}
                </ul>
            ) : (
                <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
                    Nenhuma chave criada.
                </p>
            )}
            <CreateKeyDialog open={createOpen} onOpenChange={setCreateOpen} />
            <Dialog open={Boolean(revoking)} onOpenChange={open => !open && setRevoking(null)}>
                <DialogContent
                    title={`Revogar a chave “${revoking?.name}”?`}
                    description="Os sistemas que usam esta chave param de funcionar na hora. Não dá para desfazer."
                >
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setRevoking(null)}>
                            Cancelar
                        </Button>
                        <Button
                            variant="destructive"
                            loading={revoke.isPending}
                            onClick={() => revoking && revoke.mutate(revoking)}
                        >
                            Revogar
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </section>
    );
}
