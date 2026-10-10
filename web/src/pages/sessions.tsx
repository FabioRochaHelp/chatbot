import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Plus, RotateCcw, Smartphone } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { SessionStateBadge } from '@/components/session-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useSessions } from '@/lib/queries';
import { SESSION_NAME } from '@/lib/sessions';
import type { Session } from '@/lib/types';
import { relativeTime } from '@/lib/utils';

function NewSessionDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const [name, setName] = useState('');
    const [autoStart, setAutoStart] = useState(true);
    const [touched, setTouched] = useState(false);

    const create = useMutation({
        mutationFn: () => api.post<Session>('/sessions', { name: name.trim(), autoStart }),
        onSuccess: session => {
            queryClient.setQueryData(['sessions', session.name], session);
            queryClient.invalidateQueries({ queryKey: ['sessions'], exact: true });
            onOpenChange(false);
            navigate('/sessions/' + encodeURIComponent(session.name));
        }
    });

    const valid = SESSION_NAME.test(name.trim());
    const invalid = touched && !valid;
    const submit = (event: FormEvent) => {
        event.preventDefault();
        setTouched(true);
        if (valid) create.mutate();
    };
    const error = create.error instanceof ApiError ? create.error.message : null;

    return (
        <Dialog
            open={open}
            onOpenChange={next => {
                onOpenChange(next);
                if (!next) {
                    setName('');
                    setTouched(false);
                    create.reset();
                }
            }}
        >
            <DialogContent
                title="Nova sessão"
                description="Cada sessão conecta um número de WhatsApp. Depois de criar, leia o QR code com o celular."
            >
                <form className="grid gap-4" onSubmit={submit} noValidate>
                    <Field
                        label="Nome"
                        hint="Letras, números, ponto, hífen e sublinhado. Ex.: loja-centro"
                        error={
                            invalid
                                ? 'Use só letras sem acento, números, ponto, hífen e sublinhado (sem espaços).'
                                : error || undefined
                        }
                    >
                        <Input
                            value={name}
                            onChange={event => setName(event.target.value)}
                            onBlur={() => setTouched(true)}
                            maxLength={64}
                            autoFocus
                            spellCheck={false}
                        />
                    </Field>
                    <label className="flex items-start justify-between gap-4 rounded-lg border p-3">
                        <span>
                            <span className="block text-sm font-medium">Reconectar automaticamente</span>
                            <span className="block text-[13px] text-muted-foreground">
                                A sessão volta sozinha quando o servidor reiniciar.
                            </span>
                        </span>
                        <Switch
                            checked={autoStart}
                            onCheckedChange={setAutoStart}
                            aria-label="Reconectar automaticamente"
                        />
                    </label>
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit" loading={create.isPending}>
                            Criar e conectar
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

function SessionCard({ session }: { session: Session }) {
    return (
        <Link
            to={'/sessions/' + encodeURIComponent(session.name)}
            className="group block rounded-xl focus-visible:outline-offset-4"
        >
            <Card className="h-full transition-colors group-hover:border-primary/40">
                <CardContent className="grid gap-4 p-5">
                    <div className="flex items-start justify-between gap-3">
                        <div className="flex min-w-0 items-center gap-3">
                            <span className="rounded-lg bg-muted p-2 text-muted-foreground">
                                <Smartphone className="size-4" aria-hidden />
                            </span>
                            <span className="truncate font-medium">{session.name}</span>
                        </div>
                        <SessionStateBadge state={session.state} />
                    </div>
                    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                        <span className="flex items-center gap-1.5">
                            <RotateCcw className="size-3.5" aria-hidden />
                            {session.autoStart ? 'Reconecta sozinha' : 'Não reconecta'}
                        </span>
                        {session.createdAt && <span>criada {relativeTime(session.createdAt)}</span>}
                    </div>
                </CardContent>
            </Card>
        </Link>
    );
}

export function SessionsPage() {
    const { data: sessions, isLoading } = useSessions();
    const { canManage } = useAuth();
    const [params, setParams] = useSearchParams();
    const dialogOpen = params.get('new') === '1';
    const setDialogOpen = (open: boolean) => setParams(open ? { new: '1' } : {}, { replace: true });

    return (
        <>
            <PageHeader
                title="Sessões"
                description="Cada sessão é um número de WhatsApp conectado ao ConectZap."
                actions={
                    canManage && (
                        <Button onClick={() => setDialogOpen(true)}>
                            <Plus /> Nova sessão
                        </Button>
                    )
                }
            />
            {isLoading ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {[0, 1, 2].map(index => (
                        <Skeleton key={index} className="h-28 rounded-xl" />
                    ))}
                </div>
            ) : sessions && sessions.length > 0 ? (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {sessions.map(session => (
                        <SessionCard key={session.name} session={session} />
                    ))}
                </div>
            ) : (
                <Card>
                    <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
                        <span className="rounded-full bg-primary-soft p-3 text-primary">
                            <Smartphone className="size-6" aria-hidden />
                        </span>
                        <h2 className="font-semibold">Nenhuma sessão ainda</h2>
                        <p className="max-w-sm text-sm text-muted-foreground">
                            Crie uma sessão e leia o QR code com o WhatsApp do celular para começar a enviar e receber
                            mensagens.
                        </p>
                        {canManage && (
                            <Button className="mt-2" onClick={() => setDialogOpen(true)}>
                                <Plus /> Criar primeira sessão
                            </Button>
                        )}
                    </CardContent>
                </Card>
            )}
            {canManage && <NewSessionDialog open={dialogOpen} onOpenChange={setDialogOpen} />}
        </>
    );
}
