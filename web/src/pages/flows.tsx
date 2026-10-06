import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { LayoutTemplate, ListOrdered, Plus, Trash2, Workflow } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api';
import type { Flow, FlowSummary } from '@/lib/flow-types';
import { cn, relativeTime } from '@/lib/utils';

const TEMPLATES = [
    {
        value: 'menu',
        label: 'Atendimento com menu',
        description: 'Horário de atendimento, menu de opções, pergunta e transferência. Bom ponto de partida.',
        icon: ListOrdered
    },
    { value: 'blank', label: 'Em branco', description: 'Só uma mensagem de boas-vindas.', icon: LayoutTemplate }
] as const;

function NewFlowDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [name, setName] = useState('');
    const [template, setTemplate] = useState<'menu' | 'blank'>('menu');
    const create = useMutation({
        mutationFn: () => api.post<Flow>('/flows', { name, template }),
        onSuccess: flow => {
            queryClient.setQueryData(['flows', flow.id], flow);
            queryClient.invalidateQueries({ queryKey: ['flows'], exact: true });
            navigate('/flows/' + flow.id);
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
            <DialogContent title="Novo fluxo" description="O fluxo responde automaticamente quem chama no WhatsApp.">
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
                            placeholder="Atendimento da loja"
                            maxLength={100}
                            autoFocus
                        />
                    </Field>
                    <fieldset className="grid gap-2">
                        <legend className="mb-1.5 text-sm font-medium">Começar com</legend>
                        {TEMPLATES.map(({ value, label, description, icon: Icon }) => (
                            <label
                                key={value}
                                className={cn(
                                    'flex cursor-pointer items-start gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/60',
                                    template === value && 'border-primary bg-primary-soft/40'
                                )}
                            >
                                <input
                                    type="radio"
                                    name="template"
                                    value={value}
                                    checked={template === value}
                                    onChange={() => setTemplate(value)}
                                    className="sr-only"
                                />
                                <Icon className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />
                                <span>
                                    <span className="block text-sm font-medium">{label}</span>
                                    <span className="block text-[13px] text-muted-foreground">{description}</span>
                                </span>
                            </label>
                        ))}
                    </fieldset>
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit" loading={create.isPending} disabled={!name.trim()}>
                            Criar e editar
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export function FlowsPage() {
    const queryClient = useQueryClient();
    const { data: flows, isLoading } = useQuery({
        queryKey: ['flows'],
        queryFn: () => api.get<FlowSummary[]>('/flows')
    });
    const [open, setOpen] = useState(false);
    const [removing, setRemoving] = useState<FlowSummary | null>(null);
    const remove = useMutation({
        mutationFn: (flow: FlowSummary) => api.delete('/flows/' + flow.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['flows'] });
            toast.success('Fluxo removido');
            setRemoving(null);
        },
        onError: error => toast.error(error instanceof ApiError ? error.message : 'Não foi possível remover.')
    });

    return (
        <>
            <PageHeader
                title="Fluxos"
                description="Respostas automáticas: menus, perguntas e transferência para atendentes."
                actions={
                    <Button onClick={() => setOpen(true)}>
                        <Plus /> Novo fluxo
                    </Button>
                }
            />
            {isLoading ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    <Skeleton className="h-32 rounded-xl" />
                    <Skeleton className="h-32 rounded-xl" />
                </div>
            ) : flows && flows.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {flows.map(flow => (
                        <Card key={flow.id} className="group relative transition-colors hover:border-primary/40">
                            <CardContent className="grid gap-3 p-5">
                                <div className="flex items-start justify-between gap-2">
                                    <Link
                                        to={'/flows/' + flow.id}
                                        className="font-medium after:absolute after:inset-0 after:rounded-xl"
                                    >
                                        {flow.name}
                                    </Link>
                                    <Badge
                                        tone={
                                            flow.version === 0 ? 'neutral' : flow.draftChanged ? 'warning' : 'success'
                                        }
                                    >
                                        {flow.version === 0
                                            ? 'Rascunho'
                                            : flow.draftChanged
                                              ? `v${flow.version} · alterado`
                                              : `v${flow.version}`}
                                    </Badge>
                                </div>
                                <p className="text-[13px] text-muted-foreground">
                                    {flow.sessions.length ? `Em uso: ${flow.sessions.join(', ')}` : 'Não está em uso'} ·
                                    editado {relativeTime(flow.updatedAt)}
                                </p>
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    className="relative z-10 size-8 justify-self-end text-muted-foreground"
                                    aria-label={`Remover ${flow.name}`}
                                    onClick={() => setRemoving(flow)}
                                >
                                    <Trash2 />
                                </Button>
                            </CardContent>
                        </Card>
                    ))}
                </div>
            ) : (
                <Card>
                    <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
                        <span className="rounded-full bg-primary-soft p-3 text-primary">
                            <Workflow className="size-6" aria-hidden />
                        </span>
                        <h2 className="font-semibold">Nenhum fluxo ainda</h2>
                        <p className="max-w-sm text-sm text-muted-foreground">
                            Monte um atendimento automático com menu e transferência para a equipe. Depois ligue o fluxo
                            numa sessão.
                        </p>
                        <Button className="mt-2" onClick={() => setOpen(true)}>
                            <Plus /> Criar primeiro fluxo
                        </Button>
                    </CardContent>
                </Card>
            )}
            <NewFlowDialog open={open} onOpenChange={setOpen} />
            <Dialog open={Boolean(removing)} onOpenChange={next => !next && setRemoving(null)}>
                <DialogContent
                    title={`Remover “${removing?.name}”?`}
                    description="Não dá para desfazer. Fluxos em uso por uma sessão não podem ser removidos."
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
