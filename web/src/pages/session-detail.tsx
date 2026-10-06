import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, CircleAlert, CircleCheck, CircleDashed, LoaderCircle, Power, Send } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { SessionStateBadge } from '@/components/session-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSession } from '@/lib/queries';
import { useRealtime } from '@/lib/realtime-context';
import type { Session } from '@/lib/types';

function useSessionMutation(name: string, action: (name: string) => Promise<Session>) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => action(name),
        onSuccess: session => {
            queryClient.setQueryData(['sessions', name], session);
            queryClient.invalidateQueries({ queryKey: ['sessions'], exact: true });
            queryClient.invalidateQueries({ queryKey: ['stats'] });
        }
    });
}

const path = (name: string) => '/sessions/' + encodeURIComponent(name);

function QrCode({ session }: { session: Session }) {
    const { qrcodes } = useRealtime();
    const live = qrcodes[session.name];
    // QR já existente quando a página abre; os seguintes chegam pelo socket
    const initial = useQuery({
        queryKey: ['sessions', session.name, 'qrcode'],
        queryFn: () => api.get<{ qrcode: string }>(path(session.name) + '/qrcode'),
        enabled: !live,
        retry: false,
        staleTime: 0
    });
    const qrcode = live || initial.data?.qrcode;

    return (
        <div className="grid items-center gap-6 sm:grid-cols-[auto_1fr]">
            <div className="mx-auto flex size-60 items-center justify-center rounded-xl border bg-white p-3">
                {qrcode ? (
                    <img src={qrcode} alt="QR code para conectar o WhatsApp" className="size-full" />
                ) : (
                    <LoaderCircle className="size-6 animate-spin text-neutral-400" aria-label="Carregando QR code" />
                )}
            </div>
            <div>
                <h3 className="font-medium">Leia o QR code com o celular</h3>
                <ol className="mt-3 grid list-inside list-decimal gap-2 text-sm text-muted-foreground marker:text-foreground">
                    <li>Abra o WhatsApp no celular que será usado.</li>
                    <li>
                        Toque em <strong className="font-medium text-foreground">Configurações</strong> (ou{' '}
                        <strong className="font-medium text-foreground">⋮</strong>) e depois em{' '}
                        <strong className="font-medium text-foreground">Aparelhos conectados</strong>.
                    </li>
                    <li>
                        Toque em <strong className="font-medium text-foreground">Conectar um aparelho</strong> e aponte
                        a câmera para o código.
                    </li>
                </ol>
                <p className="mt-4 text-[13px] text-muted-foreground">
                    O código se renova sozinho a cada poucos segundos; não é preciso recarregar a página.
                </p>
            </div>
        </div>
    );
}

function Connection({ session }: { session: Session }) {
    const { canManage } = useAuth();
    const start = useSessionMutation(session.name, name => api.post<Session>(path(name) + '/start'));
    const startError = start.error instanceof ApiError ? start.error.message : null;

    if (session.state === 'QRCODE' && canManage) return <QrCode session={session} />;

    const states = {
        CONNECTED: {
            icon: CircleCheck,
            tone: 'text-primary',
            title: 'Número conectado',
            text: 'A sessão está pronta para enviar e receber mensagens.'
        },
        STARTING: {
            icon: LoaderCircle,
            tone: 'text-info animate-spin',
            title: 'Abrindo o WhatsApp Web…',
            text: 'Em alguns segundos o QR code aparece aqui (ou a sessão conecta direto, se já foi lida antes).'
        },
        QRCODE: {
            icon: LoaderCircle,
            tone: 'text-warning',
            title: 'Aguardando leitura do QR code',
            text: 'Um administrador precisa ler o código com o celular.'
        },
        CLOSED: {
            icon: CircleDashed,
            tone: 'text-muted-foreground',
            title: 'Sessão fechada',
            text: 'Inicie a sessão para conectar o número. Se o QR code não for lido em cerca de 1 minuto, a sessão fecha sozinha: é só iniciar de novo para gerar outro código.'
        }
    } as const;
    const info = states[session.state as keyof typeof states] ?? {
        icon: CircleAlert,
        tone: 'text-destructive',
        title: 'A sessão precisa de atenção',
        text: `O WhatsApp informou o estado ${session.state}. Tente reconectar; se o número foi desconectado no celular, será preciso ler o QR code de novo.`
    };
    const Icon = info.icon;
    const canStart = canManage && session.state !== 'CONNECTED' && session.state !== 'STARTING';

    return (
        <div className="flex flex-col items-center gap-3 py-8 text-center">
            <Icon className={'size-10 ' + info.tone} aria-hidden />
            <div>
                <h3 className="font-medium">{info.title}</h3>
                <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">{info.text}</p>
            </div>
            {startError && <p className="text-sm text-destructive">{startError}</p>}
            {session.state === 'CONNECTED' && canManage && (
                <Button variant="outline" asChild className="mt-2">
                    <Link to={'/send?session=' + encodeURIComponent(session.name)}>
                        <Send /> Enviar mensagem de teste
                    </Link>
                </Button>
            )}
            {canStart && (
                <Button className="mt-2" loading={start.isPending} onClick={() => start.mutate()}>
                    <Power /> {session.state === 'CLOSED' ? 'Iniciar sessão' : 'Reconectar'}
                </Button>
            )}
        </div>
    );
}

function Settings({ session }: { session: Session }) {
    const { canManage } = useAuth();
    const [confirmOpen, setConfirmOpen] = useState(false);
    const patch = useSessionMutation(session.name, name =>
        api.patch<Session>(path(name), { autoStart: !session.autoStart })
    );
    const close = useSessionMutation(session.name, name => api.post<Session>(path(name) + '/close'));

    return (
        <Card>
            <CardHeader>
                <CardTitle>Configurações</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-5">
                <label className="flex items-start justify-between gap-4">
                    <span>
                        <span className="block text-sm font-medium">Reconectar automaticamente</span>
                        <span className="block text-[13px] text-muted-foreground">Ao reiniciar o servidor.</span>
                    </span>
                    <Switch
                        checked={Boolean(session.autoStart)}
                        disabled={!canManage || patch.isPending || session.autoStart === null}
                        onCheckedChange={() => patch.mutate()}
                        aria-label="Reconectar automaticamente"
                    />
                </label>
                <dl className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                        <dt className="text-[13px] text-muted-foreground">Motor</dt>
                        <dd className="font-medium">{session.engine ?? '—'}</dd>
                    </div>
                    <div>
                        <dt className="text-[13px] text-muted-foreground">Criada em</dt>
                        <dd className="font-medium">
                            {session.createdAt ? new Date(session.createdAt).toLocaleDateString('pt-BR') : '—'}
                        </dd>
                    </div>
                </dl>
                {canManage && session.state !== 'CLOSED' && (
                    <div className="border-t pt-4">
                        <Button
                            variant="outline"
                            className="w-full text-destructive"
                            onClick={() => setConfirmOpen(true)}
                        >
                            <Power /> Fechar sessão
                        </Button>
                        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
                            <DialogContent
                                title={`Fechar a sessão “${session.name}”?`}
                                description="O número para de enviar e receber mensagens pelo MyZap e não reconecta sozinho ao reiniciar. O login no celular é mantido: para voltar, basta iniciar a sessão de novo."
                            >
                                <div className="flex justify-end gap-2">
                                    <Button variant="outline" onClick={() => setConfirmOpen(false)}>
                                        Cancelar
                                    </Button>
                                    <Button
                                        variant="destructive"
                                        loading={close.isPending}
                                        onClick={() =>
                                            close.mutate(undefined, { onSuccess: () => setConfirmOpen(false) })
                                        }
                                    >
                                        Fechar sessão
                                    </Button>
                                </div>
                            </DialogContent>
                        </Dialog>
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

export function SessionDetailPage() {
    const { name = '' } = useParams();
    const { data: session, error, isLoading } = useSession(name);

    const back = (
        <Link
            to="/sessions"
            className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
        >
            <ArrowLeft className="size-4" aria-hidden /> Sessões
        </Link>
    );

    if (isLoading) {
        return (
            <>
                {back}
                <Skeleton className="mb-6 h-8 w-48" />
                <Skeleton className="h-72 rounded-xl" />
            </>
        );
    }
    if (error || !session) {
        return (
            <>
                {back}
                <PageHeader
                    title="Sessão não encontrada"
                    description={
                        error instanceof ApiError && error.status !== 404
                            ? error.message
                            : `Não existe a sessão “${name}”.`
                    }
                />
            </>
        );
    }

    return (
        <>
            {back}
            <PageHeader
                title={
                    <span className="flex flex-wrap items-center gap-3">
                        {session.name}
                        <SessionStateBadge state={session.state} className="text-[13px]" />
                    </span>
                }
            />
            <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
                <Card>
                    <CardHeader>
                        <CardTitle>Conexão</CardTitle>
                        <CardDescription>Atualiza em tempo real.</CardDescription>
                    </CardHeader>
                    <CardContent>
                        <Connection session={session} />
                    </CardContent>
                </Card>
                <Settings session={session} />
            </div>
        </>
    );
}
