import { Fragment, useEffect, useLayoutEffect, useRef } from 'react';
import { Link } from 'react-router';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, PanelRight } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { api } from '@/lib/api';
import { avatarUrl, contactName, STATUS_LABEL, statusTone } from '@/lib/contacts';
import { useSessions } from '@/lib/queries';
import { threadKey, type ThreadPage } from '@/lib/thread';
import type { Conversation } from '@/lib/types';
import { formatWaId } from '@/lib/utils';
import { Composer } from './composer';
import { ConversationActions } from './conversation-actions';
import { MessageBubble } from './message-bubble';

const PAGE = 40;
const dayFormat = new Intl.DateTimeFormat('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' });

function dayLabel(date: Date) {
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    if (date.toDateString() === today.toDateString()) return 'Hoje';
    if (date.toDateString() === yesterday.toDateString()) return 'Ontem';
    return dayFormat.format(date);
}

export function useConversation(id: number) {
    return useQuery({ queryKey: ['conversation', id], queryFn: () => api.get<Conversation>('/conversations/' + id) });
}

export function Thread({ id, onToggleDetails }: { id: number; onToggleDetails: () => void }) {
    const queryClient = useQueryClient();
    const { data: conversation, isLoading } = useConversation(id);
    const { data: sessions } = useSessions();
    const scroller = useRef<HTMLDivElement>(null);
    const nearBottom = useRef(true);
    const restore = useRef<number | null>(null);

    const messages = useInfiniteQuery({
        queryKey: threadKey(id),
        queryFn: ({ pageParam }) =>
            api.raw<ThreadPage>(
                `/conversations/${id}/messages?limit=${PAGE}${pageParam ? '&before=' + pageParam : ''}`
            ),
        initialPageParam: undefined as number | undefined,
        getNextPageParam: last => (last.meta.hasMore ? last.data[0]?.id : undefined)
    });
    const items = (messages.data?.pages ?? [])
        .slice()
        .reverse()
        .flatMap(page => page.data);
    const lastId = items[items.length - 1]?.id;

    const markRead = useMutation({
        mutationFn: () => api.patch<Conversation>('/conversations/' + id, { read: true }),
        onSuccess: updated => {
            queryClient.setQueryData(['conversation', id], updated);
            queryClient.invalidateQueries({ queryKey: ['conversations'] });
            queryClient.invalidateQueries({ queryKey: ['stats'] });
        }
    });
    const unread = conversation?.unreadCount ?? 0;
    const { mutate: read } = markRead;
    // abrir (ou receber mensagem com a conversa aberta e a aba visível) marca como lida
    useEffect(() => {
        if (unread > 0 && !document.hidden) read();
    }, [unread, lastId, read]);

    // rolagem: vai para o fim ao abrir/receber (se já estava perto do fim); ao carregar antigas, mantém a posição
    useLayoutEffect(() => {
        const element = scroller.current;
        if (!element) return;
        if (restore.current !== null) {
            element.scrollTop = element.scrollHeight - restore.current;
            restore.current = null;
        } else if (nearBottom.current) {
            element.scrollTop = element.scrollHeight;
        }
    }, [items.length, lastId]);

    useEffect(() => {
        nearBottom.current = true;
    }, [id]);

    const loadOlder = () => {
        if (scroller.current) restore.current = scroller.current.scrollHeight - scroller.current.scrollTop;
        messages.fetchNextPage();
    };

    if (isLoading || !conversation) {
        return (
            <div className="flex flex-1 flex-col gap-3 p-6">
                <Skeleton className="h-10 w-56" />
                <Skeleton className="ml-auto h-12 w-64 rounded-2xl" />
                <Skeleton className="h-12 w-72 rounded-2xl" />
            </div>
        );
    }

    const name = contactName(conversation.contact);
    const connected = sessions?.find(session => session.name === conversation.session)?.state === 'CONNECTED';

    return (
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <header className="flex items-center gap-3 border-b bg-card px-3 py-2.5 sm:px-4">
                <Button variant="ghost" size="icon" asChild className="lg:hidden">
                    <Link to="/inbox" aria-label="Voltar para a lista">
                        <ArrowLeft />
                    </Link>
                </Button>
                <Avatar
                    name={name}
                    group={conversation.contact.isGroup}
                    src={avatarUrl(conversation.contact)}
                    className="size-9"
                />
                <div className="min-w-0 flex-1">
                    <h2 className="truncate text-sm font-semibold">{name}</h2>
                    <p className="flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                        <span className="truncate">{formatWaId(conversation.contact.waId)}</span>
                        <Badge tone={statusTone(conversation)} className="px-2 py-0 text-[11px]">
                            {conversation.status === 'open' && conversation.assignedUser
                                ? conversation.assignedUser.name
                                : STATUS_LABEL[conversation.status]}
                        </Badge>
                    </p>
                </div>
                <ConversationActions conversation={conversation} />
                <Button
                    variant="ghost"
                    size="icon"
                    onClick={onToggleDetails}
                    aria-label="Detalhes do contato"
                    title="Detalhes do contato"
                >
                    <PanelRight />
                </Button>
            </header>

            <div
                ref={scroller}
                onScroll={event => {
                    const element = event.currentTarget;
                    nearBottom.current = element.scrollHeight - element.scrollTop - element.clientHeight < 120;
                }}
                className="min-h-0 flex-1 overflow-y-auto bg-muted/40 px-3 py-4 sm:px-6"
                role="log"
                aria-label={`Mensagens com ${name}`}
                aria-live="polite"
            >
                <div className="mx-auto grid max-w-3xl gap-1.5">
                    {messages.hasNextPage && (
                        <Button
                            variant="outline"
                            size="sm"
                            className="mx-auto mb-2"
                            loading={messages.isFetchingNextPage}
                            onClick={loadOlder}
                        >
                            Carregar mensagens anteriores
                        </Button>
                    )}
                    {messages.isLoading && <Skeleton className="h-12 w-64 rounded-2xl" />}
                    {items.map((message, index) => {
                        const date = new Date(message.timestamp);
                        const previous = items[index - 1];
                        const newDay = !previous || new Date(previous.timestamp).toDateString() !== date.toDateString();
                        return (
                            <Fragment key={message.id}>
                                {newDay && (
                                    <div className="my-2 flex justify-center">
                                        <span className="rounded-full bg-card px-3 py-0.5 text-xs text-muted-foreground shadow-xs first-letter:uppercase">
                                            {dayLabel(date)}
                                        </span>
                                    </div>
                                )}
                                <MessageBubble message={message} isGroup={conversation.contact.isGroup} />
                            </Fragment>
                        );
                    })}
                    {!messages.isLoading && items.length === 0 && (
                        <p className="py-10 text-center text-sm text-muted-foreground">
                            Nenhuma mensagem nesta conversa.
                        </p>
                    )}
                </div>
            </div>

            <Composer conversation={conversation} connected={connected} />
        </div>
    );
}
