import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Check, Copy, Eye, EyeOff, Pencil, RefreshCw, RotateCcw, Send, Trash2 } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { DeliveryStatusBadge } from '@/components/webhooks/delivery-status';
import { WebhookFields, type WebhookForm } from '@/components/webhooks/webhook-form';
import { api, ApiError } from '@/lib/api';
import { EVENT_INFO, type Delivery, type Webhook } from '@/lib/webhook-types';

const time = (date: string) => new Date(date).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'medium' });

const VERIFY_SNIPPET = `// Node.js: confira com o corpo BRUTO da requisição (antes do JSON.parse)
const crypto = require('crypto');
const timestamp = req.headers['x-conectzap-timestamp'];
const expected = 'sha256=' + crypto
    .createHmac('sha256', process.env.CONECTZAP_WEBHOOK_SECRET)
    .update(timestamp + '.' + rawBody)
    .digest('hex');
const valid = crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(req.headers['x-conectzap-signature'] || ''));
// recuse também timestamps muito antigos (ex.: mais de 5 minutos)`;

function CopyButton({ text, label }: { text: string; label: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <Button
            variant="outline"
            size="sm"
            onClick={async () => {
                await navigator.clipboard.writeText(text);
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
            }}
        >
            {copied ? <Check /> : <Copy />} {copied ? 'Copiado' : label}
        </Button>
    );
}

function SecretCard({ hook }: { hook: Webhook }) {
    const queryClient = useQueryClient();
    const [visible, setVisible] = useState(false);
    const [confirm, setConfirm] = useState(false);
    const rotate = useMutation({
        mutationFn: () => api.patch<Webhook>('/webhooks/' + hook.id, { rotateSecret: true }),
        onSuccess: updated => {
            queryClient.setQueryData(['webhooks', hook.id], updated);
            setConfirm(false);
            setVisible(true);
            toast.success('Segredo novo gerado', { description: 'Atualize-o no seu sistema.' });
        }
    });
    if (!hook.secret) return null;
    return (
        <Card>
            <CardHeader>
                <CardTitle>Assinatura</CardTitle>
                <CardDescription>
                    Cada envio leva <code>X-ConectZap-Signature</code> (HMAC-SHA256 de <code>timestamp.corpo</code> com
                    este segredo) e <code>X-ConectZap-Timestamp</code>. Confira no seu sistema para ter certeza de que
                    veio do ConectZap.
                </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
                <div className="flex flex-wrap items-center gap-2">
                    <code className="min-w-0 flex-1 truncate rounded-lg bg-muted px-3 py-2 text-sm">
                        {visible ? hook.secret : '•'.repeat(32)}
                    </code>
                    <Button
                        variant="outline"
                        size="sm"
                        onClick={() => setVisible(value => !value)}
                        aria-pressed={visible}
                    >
                        {visible ? <EyeOff /> : <Eye />} {visible ? 'Ocultar' : 'Mostrar'}
                    </Button>
                    <CopyButton text={hook.secret} label="Copiar" />
                    <Button variant="ghost" size="sm" onClick={() => setConfirm(true)}>
                        <RefreshCw /> Gerar outro
                    </Button>
                </div>
                <details className="rounded-lg border px-3 py-2 text-sm">
                    <summary className="cursor-pointer font-medium">Exemplo de verificação</summary>
                    <pre className="mt-2 overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-relaxed">
                        <code>{VERIFY_SNIPPET}</code>
                    </pre>
                </details>
            </CardContent>
            <Dialog open={confirm} onOpenChange={setConfirm}>
                <DialogContent
                    title="Gerar outro segredo?"
                    description="O segredo atual deixa de valer na hora: o seu sistema vai recusar os envios até ser atualizado."
                >
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setConfirm(false)}>
                            Cancelar
                        </Button>
                        <Button onClick={() => rotate.mutate()} loading={rotate.isPending}>
                            Gerar outro
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </Card>
    );
}

function Deliveries({ hook }: { hook: Webhook }) {
    const queryClient = useQueryClient();
    const { data: deliveries, isLoading } = useQuery({
        queryKey: ['webhooks', hook.id, 'deliveries'],
        queryFn: () => api.get<Delivery[]>(`/webhooks/${hook.id}/deliveries?limit=50`),
        refetchInterval: 5000
    });
    const retry = useMutation({
        mutationFn: (delivery: Delivery) => api.post('/webhook-deliveries/' + delivery.id + '/retry'),
        onSuccess: () => queryClient.invalidateQueries({ queryKey: ['webhooks', hook.id, 'deliveries'] })
    });
    const test = useMutation({
        mutationFn: () => api.post(`/webhooks/${hook.id}/test`),
        onSuccess: () => {
            toast.success('Evento de teste na fila');
            queryClient.invalidateQueries({ queryKey: ['webhooks', hook.id, 'deliveries'] });
        },
        onError: error => toast.error(error instanceof ApiError ? error.message : 'Não foi possível enviar.')
    });

    return (
        <Card>
            <CardHeader className="flex-row items-start justify-between gap-2">
                <div>
                    <CardTitle>Entregas</CardTitle>
                    <CardDescription>
                        Últimos 7 dias. Falhas são reenviadas sozinhas (até 7 tentativas, por até ~9 h).
                    </CardDescription>
                </div>
                {!hook.legacy && (
                    <Button variant="outline" size="sm" onClick={() => test.mutate()} loading={test.isPending}>
                        <Send /> Enviar teste
                    </Button>
                )}
            </CardHeader>
            <CardContent>
                {hook.legacy ? (
                    <p className="text-sm text-muted-foreground">
                        Webhooks no formato antigo (criados por <code>/sendHook</code>) recebem a mensagem original do
                        WhatsApp, sem assinatura nem reenvio. Para ter os recursos novos, crie um webhook aqui e remova
                        este.
                    </p>
                ) : isLoading ? (
                    <Skeleton className="h-24" />
                ) : deliveries && deliveries.length > 0 ? (
                    <div className="-mx-5 overflow-x-auto">
                        <table className="w-full min-w-[640px] text-sm">
                            <thead className="text-left text-xs text-muted-foreground">
                                <tr className="border-b">
                                    <th className="px-5 py-2 font-medium">Evento</th>
                                    <th className="py-2 font-medium">Situação</th>
                                    <th className="py-2 font-medium">Resposta</th>
                                    <th className="py-2 text-right font-medium">Tentativas</th>
                                    <th className="py-2 pl-4 font-medium">Quando</th>
                                    <th className="px-5 py-2" />
                                </tr>
                            </thead>
                            <tbody>
                                {deliveries.map(delivery => (
                                    <tr key={delivery.id} className="border-b last:border-0">
                                        <td className="px-5 py-2.5">
                                            <details>
                                                <summary className="cursor-pointer">
                                                    {EVENT_INFO[delivery.event as keyof typeof EVENT_INFO]?.label ??
                                                        delivery.event}
                                                </summary>
                                                <pre className="mt-2 max-h-64 max-w-md overflow-auto rounded-lg bg-muted p-2 text-[11px]">
                                                    {JSON.stringify(delivery.payload, null, 2)}
                                                </pre>
                                            </details>
                                        </td>
                                        <td className="py-2.5">
                                            <DeliveryStatusBadge status={delivery.status} />
                                        </td>
                                        <td className="py-2.5 text-muted-foreground tabular-nums">
                                            {delivery.lastError ??
                                                (delivery.lastStatus ? `HTTP ${delivery.lastStatus}` : '—')}
                                            {delivery.durationMs !== null && ` · ${delivery.durationMs} ms`}
                                        </td>
                                        <td className="py-2.5 text-right tabular-nums">{delivery.attempts}</td>
                                        <td className="py-2.5 pl-4 whitespace-nowrap text-muted-foreground">
                                            {time(delivery.createdAt)}
                                            {delivery.status === 'pending' && delivery.attempts > 0 && (
                                                <span className="block text-[11px]">
                                                    nova tentativa {time(delivery.nextAttemptAt)}
                                                </span>
                                            )}
                                        </td>
                                        <td className="px-5 py-2.5 text-right">
                                            {delivery.status !== 'success' && (
                                                <Button
                                                    variant="ghost"
                                                    size="sm"
                                                    onClick={() => retry.mutate(delivery)}
                                                    aria-label="Reenviar agora"
                                                >
                                                    <RotateCcw /> Reenviar
                                                </Button>
                                            )}
                                        </td>
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>
                ) : (
                    <p className="py-6 text-center text-sm text-muted-foreground">
                        Nenhuma entrega ainda. Use “Enviar teste” para conferir a integração.
                    </p>
                )}
            </CardContent>
        </Card>
    );
}

export function WebhookDetailPage() {
    const id = Number(useParams().id);
    const navigate = useNavigate();
    const [params] = useSearchParams();
    const queryClient = useQueryClient();
    const { data: hook, isLoading } = useQuery({
        queryKey: ['webhooks', id],
        queryFn: () => api.get<Webhook>('/webhooks/' + id)
    });
    const [editing, setEditing] = useState(false);
    const [removing, setRemoving] = useState(false);

    const update = useMutation({
        mutationFn: (body: Partial<WebhookForm> & { active?: boolean }) => api.patch<Webhook>('/webhooks/' + id, body),
        onSuccess: updated => {
            queryClient.setQueryData(['webhooks', id], updated);
            queryClient.invalidateQueries({ queryKey: ['webhooks'], exact: true });
            setEditing(false);
        },
        onError: error => toast.error(error instanceof ApiError ? error.message : 'Não foi possível salvar.')
    });
    const remove = useMutation({
        mutationFn: () => api.delete('/webhooks/' + id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['webhooks'] });
            toast.success('Webhook removido');
            navigate('/webhooks');
        }
    });

    if (isLoading) return <Skeleton className="h-72 rounded-xl" />;
    if (!hook) {
        return (
            <p className="py-10 text-center">
                Webhook não encontrado.{' '}
                <Link to="/webhooks" className="text-primary">
                    Voltar
                </Link>
            </p>
        );
    }

    return (
        <>
            <Link
                to="/webhooks"
                className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
                <ArrowLeft className="size-4" aria-hidden /> Webhooks
            </Link>
            <PageHeader
                title={<span className="font-mono text-lg break-all sm:text-xl">{hook.url}</span>}
                description={`${hook.session ? 'Sessão ' + hook.session : 'Todas as sessões'} · ${hook.legacy ? 'formato antigo' : hook.events.map(event => EVENT_INFO[event]?.label ?? event).join(', ')}`}
                actions={
                    <>
                        <label className="flex items-center gap-2 rounded-lg border px-3 text-sm">
                            <Switch
                                checked={hook.active}
                                onCheckedChange={active => update.mutate({ active })}
                                aria-label="Ativo"
                            />
                            {hook.active ? 'Ativo' : 'Pausado'}
                        </label>
                        <Button variant="outline" onClick={() => setEditing(true)}>
                            <Pencil /> Editar
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setRemoving(true)}
                            aria-label="Remover webhook"
                        >
                            <Trash2 />
                        </Button>
                    </>
                }
            />
            {params.get('novo') && hook.secret && (
                <p
                    className="mb-4 rounded-xl border border-primary/30 bg-primary-soft/50 px-4 py-3 text-sm"
                    role="status"
                >
                    Webhook criado. Copie o segredo abaixo e configure a verificação da assinatura no seu sistema.
                </p>
            )}
            {/* minmax(0,1fr): a tabela de entregas rola dentro do card, sem alargar a página */}
            <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
                <SecretCard hook={hook} />
                <Deliveries hook={hook} />
            </div>
            <Dialog open={editing} onOpenChange={setEditing}>
                <DialogContent title="Editar webhook" className="max-w-lg">
                    {editing && (
                        <WebhookFields
                            initial={{ url: hook.url, session: hook.session, events: hook.events }}
                            legacy={hook.legacy}
                            submitLabel="Salvar"
                            pending={update.isPending}
                            error={update.error}
                            onSubmit={form => update.mutate(hook.legacy ? { url: form.url } : form)}
                            onCancel={() => setEditing(false)}
                        />
                    )}
                </DialogContent>
            </Dialog>
            <Dialog open={removing} onOpenChange={setRemoving}>
                <DialogContent
                    title="Remover este webhook?"
                    description="O seu sistema deixa de receber os eventos. O histórico de entregas também é apagado."
                >
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setRemoving(false)}>
                            Cancelar
                        </Button>
                        <Button variant="destructive" loading={remove.isPending} onClick={() => remove.mutate()}>
                            Remover
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </>
    );
}
