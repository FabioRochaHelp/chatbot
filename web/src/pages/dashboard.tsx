import { Link } from 'react-router';
import { ArrowRight, Hourglass, MessagesSquare, Plus, Smartphone, UserRoundCheck, type LucideIcon } from 'lucide-react';
import { MessagesChart } from '@/components/messages-chart';
import { PageHeader } from '@/components/page-header';
import { SessionStateBadge } from '@/components/session-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth } from '@/lib/auth';
import { useSessions, useStats } from '@/lib/queries';
import { formatNumber } from '@/lib/utils';

const today = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date());

function StatTile({
    label,
    value,
    detail,
    icon: Icon
}: {
    label: string;
    value?: string;
    detail?: string;
    icon: LucideIcon;
}) {
    return (
        <Card>
            <CardContent className="flex items-start justify-between gap-3 p-4 sm:p-5">
                <div className="min-w-0">
                    <p className="text-[13px] text-muted-foreground">{label}</p>
                    {value === undefined ? (
                        <Skeleton className="mt-2 h-7 w-12" />
                    ) : (
                        <p className="mt-1 text-2xl font-semibold tracking-tight">{value}</p>
                    )}
                    {detail && <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>}
                </div>
                <span className="hidden rounded-lg bg-muted p-2 text-muted-foreground sm:block">
                    <Icon className="size-4" aria-hidden />
                </span>
            </CardContent>
        </Card>
    );
}

function SessionsCard() {
    const { data: sessions, isLoading } = useSessions();
    const { canManage } = useAuth();
    return (
        <Card className="flex flex-col">
            <CardHeader className="flex-row items-center justify-between">
                <CardTitle>Sessões</CardTitle>
                <Button variant="link" size="sm" asChild className="h-auto px-0">
                    <Link to="/sessions">
                        Ver todas <ArrowRight />
                    </Link>
                </Button>
            </CardHeader>
            <CardContent className="flex-1">
                {isLoading ? (
                    <div className="grid gap-3">
                        <Skeleton className="h-10" />
                        <Skeleton className="h-10" />
                    </div>
                ) : sessions && sessions.length > 0 ? (
                    <ul className="-mx-2 grid gap-0.5">
                        {sessions.slice(0, 6).map(session => (
                            <li key={session.name}>
                                <Link
                                    to={'/sessions/' + encodeURIComponent(session.name)}
                                    className="flex items-center justify-between gap-3 rounded-lg px-2 py-2.5 hover:bg-muted"
                                >
                                    <span className="truncate text-sm font-medium">{session.name}</span>
                                    <SessionStateBadge state={session.state} />
                                </Link>
                            </li>
                        ))}
                    </ul>
                ) : (
                    <div className="flex h-full flex-col items-center justify-center gap-3 py-6 text-center">
                        <Smartphone className="size-8 text-muted-foreground" aria-hidden />
                        <p className="text-sm text-muted-foreground">Nenhum número conectado ainda.</p>
                        {canManage && (
                            <Button size="sm" asChild>
                                <Link to="/sessions?new=1">
                                    <Plus /> Conectar número
                                </Link>
                            </Button>
                        )}
                    </div>
                )}
            </CardContent>
        </Card>
    );
}

export function DashboardPage() {
    const { data: stats } = useStats();
    const todayTotal = stats ? stats.messagesToday.in + stats.messagesToday.out : undefined;

    return (
        <>
            <PageHeader title="Painel" description={<span className="first-letter:uppercase">{today}</span>} />

            <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
                <StatTile
                    label="Sessões conectadas"
                    icon={Smartphone}
                    value={stats && `${stats.sessions.connected} de ${stats.sessions.total}`}
                />
                <StatTile
                    label="Aguardando atendente"
                    icon={Hourglass}
                    value={stats && formatNumber(stats.conversations.pending)}
                />
                <StatTile
                    label="Em atendimento"
                    icon={UserRoundCheck}
                    value={stats && formatNumber(stats.conversations.open)}
                    detail={stats && `${formatNumber(stats.conversations.bot)} com o bot`}
                />
                <StatTile label="Não lidas" icon={MessagesSquare} value={stats && formatNumber(stats.unread)} />
            </div>

            <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <Card className="lg:col-span-2">
                    <CardHeader>
                        <CardDescription>Mensagens hoje</CardDescription>
                        {todayTotal === undefined ? (
                            <Skeleton className="h-12 w-24" />
                        ) : (
                            <p className="text-5xl font-semibold tracking-tight">{formatNumber(todayTotal)}</p>
                        )}
                        {stats && (
                            <p className="text-[13px] text-muted-foreground">
                                {formatNumber(stats.messagesToday.in)} recebidas ·{' '}
                                {formatNumber(stats.messagesToday.out)} enviadas
                            </p>
                        )}
                    </CardHeader>
                    <CardContent>
                        <h2 className="sr-only">Mensagens nos últimos 7 dias</h2>
                        {stats ? <MessagesChart data={stats.messagesByDay} /> : <Skeleton className="h-60" />}
                    </CardContent>
                </Card>
                <SessionsCard />
            </div>
        </>
    );
}
