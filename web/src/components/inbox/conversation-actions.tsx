import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bot, Building2, CheckCheck, ChevronDown, Hand, RotateCcw, Undo2, UserRoundCog } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuLabel,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger
} from '@/components/ui/dropdown-menu';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDepartments, useDirectory, useSessions } from '@/lib/queries';
import type { Conversation, ConversationStatus } from '@/lib/types';

type Change = { status?: ConversationStatus; assignedUserId?: number | null; departmentId?: number | null };

export function ConversationActions({ conversation }: { conversation: Conversation }) {
    const queryClient = useQueryClient();
    const { user, canManage } = useAuth();
    const { data: directory } = useDirectory();
    const { data: departments } = useDepartments();
    const { data: sessions } = useSessions();
    const botEnabled = sessions?.find(session => session.name === conversation.session)?.botMode !== 'off';

    const change = useMutation({
        mutationFn: (body: Change) => api.patch<Conversation>('/conversations/' + conversation.id, body),
        onSuccess: (updated, body) => {
            queryClient.setQueryData(['conversation', updated.id], updated);
            queryClient.invalidateQueries({ queryKey: ['conversations'] });
            const messages: Partial<Record<ConversationStatus, string>> = {
                closed: 'Conversa encerrada',
                pending: 'Conversa devolvida à fila',
                bot: 'Conversa devolvida ao bot'
            };
            if (body.departmentId !== undefined) {
                toast.success(
                    updated.assignedUser
                        ? `Transferida para ${updated.department?.name} · com ${updated.assignedUser.name}`
                        : `Transferida para a fila ${updated.department?.name ?? 'Sem departamento'}`
                );
            } else if (body.status === 'open' && !body.assignedUserId && updated.assignedUserId === user?.id) {
                toast.success('Conversa assumida');
            } else if (body.assignedUserId === user?.id) toast.success('Conversa assumida');
            else if (body.assignedUserId) toast.success(`Transferida para ${updated.assignedUser?.name}`);
            else if (body.status && messages[body.status]) toast.success(messages[body.status]!);
        },
        onError: error => {
            toast.error(error instanceof ApiError ? error.message : 'Não foi possível alterar.');
            // assumida por outro atendente: mostra quem ficou com ela
            if (error instanceof ApiError && error.code === 'ALREADY_ASSIGNED') {
                queryClient.invalidateQueries({ queryKey: ['conversation', conversation.id] });
                queryClient.invalidateQueries({ queryKey: ['conversations'] });
            }
        }
    });

    const mine = conversation.status === 'open' && conversation.assignedUserId === user?.id;
    const others = (directory ?? []).filter(item => item.id !== conversation.assignedUserId);
    const targets = (departments ?? []).filter(item => item.id !== conversation.departmentId);
    // fila distribuída: quem entrega é o rodízio (o admin ainda pode atribuir)
    const distributed =
        conversation.status === 'pending' && conversation.department?.mode === 'distribuida' && !canManage;
    // outro atendente já está com a conversa: para pegar, use "Transferir para…"
    const takenByOther = conversation.status === 'open' && conversation.assignedUserId && !mine;

    let primary: { label: string; icon: typeof Hand; body: Change } | null = null;
    if (conversation.status === 'closed') primary = { label: 'Reabrir', icon: RotateCcw, body: { status: 'open' } };
    else if (!mine && user && !distributed && !takenByOther)
        primary = { label: 'Assumir', icon: Hand, body: { status: 'open' } };
    else if (mine) primary = { label: 'Encerrar', icon: CheckCheck, body: { status: 'closed' } };

    return (
        <div className="flex items-center gap-2">
            {primary && (
                <Button
                    size="sm"
                    variant={primary.label === 'Encerrar' ? 'outline' : 'default'}
                    loading={change.isPending && change.variables === primary.body}
                    onClick={() => change.mutate(primary.body)}
                    aria-label={primary.label}
                    title={primary.label}
                >
                    <primary.icon />
                    {/* no celular só o ícone, para sobrar espaço para o nome do contato */}
                    <span className="hidden sm:inline">{primary.label}</span>
                </Button>
            )}
            <DropdownMenu>
                <DropdownMenuTrigger asChild>
                    <Button size="sm" variant="outline" aria-label="Mais ações">
                        <span className="hidden sm:inline">Mais</span>
                        <ChevronDown />
                    </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end">
                    {distributed && (
                        <DropdownMenuLabel className="max-w-56 text-xs font-normal text-muted-foreground">
                            Fila distribuída: a conversa vai para o próximo atendente disponível.
                        </DropdownMenuLabel>
                    )}
                    <DropdownMenuSub>
                        <DropdownMenuSubTrigger disabled={others.length === 0 && targets.length === 0}>
                            <UserRoundCog /> Transferir para…
                        </DropdownMenuSubTrigger>
                        <DropdownMenuSubContent>
                            {(targets.length > 0 || conversation.departmentId !== null) && (
                                <>
                                    <DropdownMenuLabel>Departamentos</DropdownMenuLabel>
                                    {targets.map(item => (
                                        <DropdownMenuItem
                                            key={'d' + item.id}
                                            onSelect={() => change.mutate({ departmentId: item.id })}
                                        >
                                            <Building2 /> {item.name}
                                        </DropdownMenuItem>
                                    ))}
                                    {conversation.departmentId !== null && (
                                        <DropdownMenuItem onSelect={() => change.mutate({ departmentId: null })}>
                                            <Building2 /> Sem departamento
                                        </DropdownMenuItem>
                                    )}
                                    <DropdownMenuSeparator />
                                </>
                            )}
                            <DropdownMenuLabel>Atendentes</DropdownMenuLabel>
                            {others.map(item => (
                                <DropdownMenuItem
                                    key={item.id}
                                    onSelect={() => change.mutate({ status: 'open', assignedUserId: item.id })}
                                >
                                    {item.name}
                                    {item.id === user?.id && (
                                        <span className="text-xs text-muted-foreground">(você)</span>
                                    )}
                                </DropdownMenuItem>
                            ))}
                        </DropdownMenuSubContent>
                    </DropdownMenuSub>
                    {conversation.status !== 'pending' && (
                        <DropdownMenuItem onSelect={() => change.mutate({ status: 'pending' })}>
                            <Undo2 /> Devolver à fila
                        </DropdownMenuItem>
                    )}
                    {botEnabled && conversation.status !== 'bot' && (
                        <DropdownMenuItem onSelect={() => change.mutate({ status: 'bot' })}>
                            <Bot /> Devolver ao bot
                        </DropdownMenuItem>
                    )}
                    {conversation.status !== 'closed' && !mine && (
                        <>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem onSelect={() => change.mutate({ status: 'closed' })}>
                                <CheckCheck /> Encerrar
                            </DropdownMenuItem>
                        </>
                    )}
                </DropdownMenuContent>
            </DropdownMenu>
        </div>
    );
}
