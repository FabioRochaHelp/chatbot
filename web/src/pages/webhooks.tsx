import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Plus, Webhook as WebhookIcon } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { DeliveryStatusBadge } from '@/components/webhooks/delivery-status';
import { WebhookFields, type WebhookForm } from '@/components/webhooks/webhook-form';
import { api } from '@/lib/api';
import { relativeTime } from '@/lib/utils';
import { EVENT_INFO, type Webhook } from '@/lib/webhook-types';

export function WebhooksPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { data: hooks, isLoading } = useQuery({
        queryKey: ['webhooks'],
        queryFn: () => api.get<Webhook[]>('/webhooks')
    });
    const [open, setOpen] = useState(false);
    const create = useMutation({
        mutationFn: (form: WebhookForm) => api.post<Webhook>('/webhooks', form),
        onSuccess: hook => {
            queryClient.setQueryData(['webhooks', hook.id], hook);
            queryClient.invalidateQueries({ queryKey: ['webhooks'], exact: true });
            navigate('/webhooks/' + hook.id + '?novo=1');
        }
    });

    return (
        <>
            <PageHeader
                title="Webhooks"
                description="Avise outros sistemas (CRM, ERP, planilhas, automações) quando algo acontecer no ConectZap."
                actions={
                    <Button onClick={() => setOpen(true)}>
                        <Plus /> Novo webhook
                    </Button>
                }
            />
            {isLoading ? (
                <Skeleton className="h-32 rounded-xl" />
            ) : hooks && hooks.length > 0 ? (
                <ul className="grid gap-3">
                    {hooks.map(hook => (
                        <li key={hook.id}>
                            <Link to={'/webhooks/' + hook.id} className="block rounded-xl">
                                <Card className="transition-colors hover:border-primary/40">
                                    <CardContent className="grid gap-2 p-4 sm:grid-cols-[1fr_auto] sm:items-center">
                                        <div className="min-w-0">
                                            <p className="flex flex-wrap items-center gap-2">
                                                <span className="truncate font-mono text-sm">{hook.url}</span>
                                                {!hook.active && <Badge>Pausado</Badge>}
                                                {hook.legacy && <Badge tone="info">Formato antigo (/sendHook)</Badge>}
                                            </p>
                                            <p className="mt-1 text-[13px] text-muted-foreground">
                                                {hook.session ? `Sessão ${hook.session}` : 'Todas as sessões'} ·{' '}
                                                {hook.legacy
                                                    ? 'mensagens recebidas (corpo original do WhatsApp)'
                                                    : hook.events
                                                          .map(event => EVENT_INFO[event]?.label ?? event)
                                                          .join(', ')}
                                            </p>
                                        </div>
                                        <div className="flex items-center gap-2 text-[13px] text-muted-foreground">
                                            {hook.failedDeliveries > 0 && (
                                                <Badge tone="danger">{hook.failedDeliveries} falharam</Badge>
                                            )}
                                            {hook.lastDelivery ? (
                                                <>
                                                    <DeliveryStatusBadge status={hook.lastDelivery.status} />
                                                    <span>{relativeTime(hook.lastDelivery.createdAt)}</span>
                                                </>
                                            ) : (
                                                !hook.legacy && <span>Nenhuma entrega ainda</span>
                                            )}
                                        </div>
                                    </CardContent>
                                </Card>
                            </Link>
                        </li>
                    ))}
                </ul>
            ) : (
                <Card>
                    <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
                        <span className="rounded-full bg-primary-soft p-3 text-primary">
                            <WebhookIcon className="size-6" aria-hidden />
                        </span>
                        <h2 className="font-semibold">Nenhum webhook</h2>
                        <p className="max-w-md text-sm text-muted-foreground">
                            O ConectZap envia um POST com JSON assinado para o seu sistema a cada evento escolhido e
                            tenta de novo se ele estiver fora do ar.
                        </p>
                        <Button className="mt-2" onClick={() => setOpen(true)}>
                            <Plus /> Criar webhook
                        </Button>
                    </CardContent>
                </Card>
            )}
            <Dialog
                open={open}
                onOpenChange={next => {
                    setOpen(next);
                    if (!next) create.reset();
                }}
            >
                <DialogContent title="Novo webhook" className="max-w-lg">
                    {open && (
                        <WebhookFields
                            initial={{ url: '', session: null, events: ['message.received', 'conversation.handoff'] }}
                            submitLabel="Criar webhook"
                            pending={create.isPending}
                            error={create.error}
                            onSubmit={form => create.mutate(form)}
                            onCancel={() => setOpen(false)}
                        />
                    )}
                </DialogContent>
            </Dialog>
        </>
    );
}
