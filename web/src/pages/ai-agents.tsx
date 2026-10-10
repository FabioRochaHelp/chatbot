import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, Sparkles, Trash2 } from 'lucide-react';
import { AiUnavailable } from '@/components/ai/ai-unavailable';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api';
import { useAiAgents, useAiStatus } from '@/lib/ai-queries';
import { formatUsd, type AiAgent } from '@/lib/ai-types';
import { formatNumber } from '@/lib/utils';

function NewAgentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { data: status } = useAiStatus();
    const [name, setName] = useState('');
    const [model, setModel] = useState('');
    const create = useMutation({
        mutationFn: () => api.post<AiAgent>('/ai-agents', { name, model: model || undefined }),
        onSuccess: agent => {
            queryClient.invalidateQueries({ queryKey: ['ai-agents'] });
            navigate('/ai/' + agent.id);
        }
    });
    return (
        <Dialog
            open={open}
            onOpenChange={next => {
                onOpenChange(next);
                if (!next) {
                    setName('');
                    create.reset();
                }
            }}
        >
            <DialogContent
                title="Novo assistente de IA"
                description="Ele responde clientes usando as instruções e a base de conhecimento que você escrever."
            >
                <form
                    className="grid gap-4"
                    onSubmit={(event: FormEvent) => {
                        event.preventDefault();
                        if (name.trim()) create.mutate();
                    }}
                >
                    <Field label="Nome" error={create.error instanceof ApiError ? create.error.message : undefined}>
                        <Input
                            value={name}
                            onChange={event => setName(event.target.value)}
                            placeholder="Atendente virtual"
                            maxLength={100}
                            autoFocus
                        />
                    </Field>
                    <Field label="Modelo" hint="Dá para trocar depois.">
                        <Select
                            value={model || status?.defaultModel || ''}
                            onChange={event => setModel(event.target.value)}
                        >
                            {status?.models.map(item => (
                                <option key={item.id} value={item.id}>
                                    {item.label} · US$ {item.input} / {item.output} por milhão de tokens
                                    {item.id === status.defaultModel ? ' (recomendado)' : ''}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
                            Criar e configurar
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export function AiAgentsPage() {
    const queryClient = useQueryClient();
    const { data: agents, isLoading } = useAiAgents();
    const { data: status } = useAiStatus();
    const [open, setOpen] = useState(false);
    const [removing, setRemoving] = useState<AiAgent | null>(null);
    const remove = useMutation({
        mutationFn: (agent: AiAgent) => api.delete('/ai-agents/' + agent.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['ai-agents'] });
            toast.success('Assistente removido');
            setRemoving(null);
        },
        onError: error => toast.error(error instanceof ApiError ? error.message : 'Não foi possível remover.')
    });
    const modelLabel = (id: string) => status?.models.find(model => model.id === id)?.label ?? id;

    return (
        <>
            <PageHeader
                title="Assistentes de IA"
                description="Respostas automáticas com Claude, a partir das suas instruções e base de conhecimento."
                actions={
                    <Button onClick={() => setOpen(true)}>
                        <Plus /> Novo assistente
                    </Button>
                }
            />
            <AiUnavailable />
            {isLoading ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Skeleton className="h-36 rounded-xl" />
                </div>
            ) : agents && agents.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {agents.map(agent => (
                        <Card key={agent.id} className="relative transition-colors hover:border-primary/40">
                            <CardContent className="grid gap-3 p-5">
                                <div className="flex items-start gap-3">
                                    <span className="rounded-lg bg-primary-soft p-2 text-primary">
                                        <Sparkles className="size-4" aria-hidden />
                                    </span>
                                    <div className="min-w-0 flex-1">
                                        <Link
                                            to={'/ai/' + agent.id}
                                            className="font-medium after:absolute after:inset-0 after:rounded-xl"
                                        >
                                            {agent.name}
                                        </Link>
                                        <p className="text-[13px] text-muted-foreground">{modelLabel(agent.model)}</p>
                                    </div>
                                </div>
                                <dl className="grid grid-cols-3 gap-2 text-center">
                                    {[
                                        ['Respostas', formatNumber(agent.usage.replies)],
                                        ['Transferidas', formatNumber(agent.usage.handoffs)],
                                        ['Custo', formatUsd(agent.usage.costUsd)]
                                    ].map(([label, value]) => (
                                        <div key={label} className="rounded-lg bg-muted px-2 py-1.5">
                                            <dt className="text-[11px] text-muted-foreground">{label}</dt>
                                            <dd className="text-sm font-semibold tabular-nums">{value}</dd>
                                        </div>
                                    ))}
                                </dl>
                                <div className="flex items-center justify-between text-[13px] text-muted-foreground">
                                    <span>
                                        {agent.sessions.length
                                            ? `Em uso: ${agent.sessions.join(', ')}`
                                            : 'Não está em uso'}{' '}
                                        · 30 dias
                                    </span>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        className="relative z-10 size-8"
                                        aria-label={`Remover ${agent.name}`}
                                        onClick={() => setRemoving(agent)}
                                    >
                                        <Trash2 />
                                    </Button>
                                </div>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            ) : (
                <Card>
                    <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
                        <span className="rounded-full bg-primary-soft p-3 text-primary">
                            <Sparkles className="size-6" aria-hidden />
                        </span>
                        <h2 className="font-semibold">Nenhum assistente ainda</h2>
                        <p className="max-w-md text-sm text-muted-foreground">
                            Escreva como ele deve atender e o que precisa saber da empresa (horários, preços,
                            políticas). Ele transfere para a equipe quando não souber responder.
                        </p>
                        <Button className="mt-2" onClick={() => setOpen(true)}>
                            <Plus /> Criar primeiro assistente
                        </Button>
                    </CardContent>
                </Card>
            )}
            <NewAgentDialog open={open} onOpenChange={setOpen} />
            <Dialog open={Boolean(removing)} onOpenChange={next => !next && setRemoving(null)}>
                <DialogContent
                    title={`Remover “${removing?.name}”?`}
                    description="Assistentes em uso por sessões ou fluxos não podem ser removidos."
                >
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setRemoving(null)}>
                            Cancelar
                        </Button>
                        <Button
                            variant="destructive"
                            loading={remove.isPending}
                            onClick={() => removing && remove.mutate(removing)}
                        >
                            Remover
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
