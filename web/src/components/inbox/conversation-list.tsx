import { useEffect, useState } from 'react';
import { NavLink } from 'react-router';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Bell, Inbox, Search } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Input, Select } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { contactName, preview, STATUS_LABEL } from '@/lib/contacts';
import { notificationsSupported } from '@/lib/notifications';
import { useSessions } from '@/lib/queries';
import type { Conversation } from '@/lib/types';
import { cn } from '@/lib/utils';

export type Filter = 'queue' | 'mine' | 'open' | 'closed';

const FILTERS: { value: Filter; label: string; query: string; userOnly?: boolean }[] = [
    { value: 'queue', label: 'Fila', query: 'status=pending' },
    { value: 'mine', label: 'Minhas', query: 'status=open&assigned=me', userOnly: true },
    { value: 'open', label: 'Abertas', query: 'status=bot,pending,open' },
    { value: 'closed', label: 'Encerradas', query: 'status=closed' }
];

const PAGE = 30;

function listTime(date: string) {
    const value = new Date(date);
    const today = new Date();
    if (value.toDateString() === today.toDateString()) {
        return value.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    }
    const days = (today.getTime() - value.getTime()) / 86400000;
    if (days < 6) return value.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
    return value.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function useDebounced<T>(value: T, delay = 300) {
    const [debounced, setDebounced] = useState(value);
    useEffect(() => {
        const timer = setTimeout(() => setDebounced(value), delay);
        return () => clearTimeout(timer);
    }, [value, delay]);
    return debounced;
}

function NotificationsButton() {
    const [permission, setPermission] = useState(() => (notificationsSupported() ? Notification.permission : 'denied'));
    if (permission !== 'default') return null;
    return (
        <Button
            variant="ghost"
            size="icon"
            className="size-8"
            title="Avisar novas mensagens"
            aria-label="Ativar notificações de novas mensagens"
            onClick={async () => setPermission(await Notification.requestPermission())}
        >
            <Bell />
        </Button>
    );
}

export function ConversationList({ filter, onFilter }: { filter: Filter; onFilter: (filter: Filter) => void }) {
    const { user } = useAuth();
    const { data: sessions } = useSessions();
    const [search, setSearch] = useState('');
    const [session, setSession] = useState('');
    const q = useDebounced(search.trim());
    const filters = FILTERS.filter(item => !item.userOnly || user);
    const current = filters.find(item => item.value === filter) ?? filters[0];

    const params = [
        current.query,
        q && 'q=' + encodeURIComponent(q),
        session && 'session=' + encodeURIComponent(session)
    ]
        .filter(Boolean)
        .join('&');
    const list = useInfiniteQuery({
        queryKey: ['conversations', params],
        queryFn: ({ pageParam }) =>
            api.page<Conversation>(`/conversations?${params}&limit=${PAGE}&offset=${pageParam}`),
        initialPageParam: 0,
        getNextPageParam: (last, pages) => {
            const loaded = pages.reduce((sum, page) => sum + page.data.length, 0);
            return loaded < last.meta.total ? loaded : undefined;
        }
    });
    const conversations = list.data?.pages.flatMap(page => page.data) ?? [];
    const total = list.data?.pages[0]?.meta.total;

    return (
        <div className="flex min-h-0 flex-1 flex-col">
            <div className="grid gap-2.5 border-b p-3">
                <div className="flex items-center justify-between gap-2">
                    <h1 className="text-lg font-semibold">Atendimento</h1>
                    <NotificationsButton />
                </div>
                <div className="flex rounded-lg bg-muted p-0.5" role="tablist" aria-label="Filtro de conversas">
                    {filters.map(item => (
                        <button
                            key={item.value}
                            type="button"
                            role="tab"
                            aria-selected={item.value === current.value}
                            onClick={() => onFilter(item.value)}
                            className={cn(
                                'flex-1 rounded-md px-2 py-1 text-[13px] font-medium text-muted-foreground transition-colors hover:text-foreground',
                                item.value === current.value && 'bg-card text-foreground shadow-xs'
                            )}
                        >
                            {item.label}
                        </button>
                    ))}
                </div>
                <div className="flex gap-2">
                    <div className="relative flex-1">
                        <Search
                            className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground"
                            aria-hidden
                        />
                        <Input
                            type="search"
                            value={search}
                            onChange={event => setSearch(event.target.value)}
                            placeholder="Nome ou número"
                            aria-label="Buscar conversa"
                            className="h-8 pl-8"
                        />
                    </div>
                    {sessions && sessions.length > 1 && (
                        <Select
                            value={session}
                            onChange={event => setSession(event.target.value)}
                            aria-label="Sessão"
                            className="h-8 w-auto max-w-32"
                        >
                            <option value="">Todas</option>
                            {sessions.map(item => (
                                <option key={item.name} value={item.name}>
                                    {item.name}
                                </option>
                            ))}
                        </Select>
                    )}
                </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
                {list.isLoading ? (
                    <div className="grid gap-3 p-3">
                        {[0, 1, 2, 3].map(index => (
                            <Skeleton key={index} className="h-14" />
                        ))}
                    </div>
                ) : conversations.length === 0 ? (
                    <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
                        <Inbox className="size-8 text-muted-foreground" aria-hidden />
                        <p className="text-sm font-medium">
                            {q ? 'Nada encontrado' : current.value === 'queue' ? 'Fila vazia' : 'Nenhuma conversa aqui'}
                        </p>
                        <p className="text-[13px] text-muted-foreground">
                            {q
                                ? 'Tente outro nome ou número.'
                                : current.value === 'queue'
                                  ? 'Novas conversas que precisam de atendente aparecem aqui.'
                                  : 'Quando houver conversas neste filtro, elas aparecem aqui.'}
                        </p>
                    </div>
                ) : (
                    <ul aria-label={`${total} conversas`}>
                        {conversations.map(conversation => {
                            const name = contactName(conversation.contact);
                            return (
                                <li key={conversation.id}>
                                    <NavLink
                                        to={'/inbox/' + conversation.id + '?f=' + current.value}
                                        className={({ isActive }) =>
                                            cn(
                                                'flex gap-3 border-b border-border/60 px-3 py-3 transition-colors hover:bg-muted/60',
                                                isActive && 'bg-primary-soft/60 hover:bg-primary-soft/60'
                                            )
                                        }
                                    >
                                        <Avatar name={name} group={conversation.contact.isGroup} />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-baseline justify-between gap-2">
                                                <span
                                                    className={cn(
                                                        'truncate text-sm',
                                                        conversation.unreadCount > 0 ? 'font-semibold' : 'font-medium'
                                                    )}
                                                >
                                                    {name}
                                                </span>
                                                <time
                                                    className="shrink-0 text-xs text-muted-foreground"
                                                    dateTime={conversation.lastMessageAt}
                                                >
                                                    {listTime(conversation.lastMessageAt)}
                                                </time>
                                            </div>
                                            <div className="mt-0.5 flex items-center justify-between gap-2">
                                                <span className="truncate text-[13px] text-muted-foreground">
                                                    {conversation.lastMessage?.direction === 'out' && 'Você: '}
                                                    {preview(conversation.lastMessage)}
                                                </span>
                                                {conversation.unreadCount > 0 && (
                                                    <span className="flex h-5 min-w-5 shrink-0 items-center justify-center rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">
                                                        <span className="sr-only">Não lidas: </span>
                                                        {conversation.unreadCount}
                                                    </span>
                                                )}
                                            </div>
                                            {current.value === 'open' && (
                                                <p className="mt-1 text-[11px] text-muted-foreground">
                                                    {conversation.status === 'open' && conversation.assignedUser
                                                        ? conversation.assignedUser.name
                                                        : STATUS_LABEL[conversation.status]}
                                                </p>
                                            )}
                                        </div>
                                    </NavLink>
                                </li>
                            );
                        })}
                    </ul>
                )}
                {list.hasNextPage && (
                    <div className="p-3">
                        <Button
                            variant="ghost"
                            size="sm"
                            className="w-full"
                            loading={list.isFetchingNextPage}
                            onClick={() => list.fetchNextPage()}
                        >
                            Carregar mais
                        </Button>
                    </div>
                )}
            </div>
        </div>
    );
}
