import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { useNavigate } from 'react-router';
import { authStatusKey, useAuth } from './auth';
import { contactName, preview } from './contacts';
import { notify } from './notifications';
import { RealtimeContext } from './realtime-context';
import { upsertMessage } from './thread';
import type { Contact, Conversation, Message, Session } from './types';

type SavedEvent = { session: string; message: Message; conversation: Conversation; contact: Contact };

type StateEvent = { session: string; state: string };

/** Uma conexão Socket.IO por aba; os eventos atualizam o cache do React Query. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
    const queryClient = useQueryClient();
    const [connected, setConnected] = useState(false);
    const [qrcodes, setQrcodes] = useState<Record<string, string>>({});
    const statsTimer = useRef<number | undefined>(undefined);
    const listTimer = useRef<number | undefined>(undefined);
    const navigate = useNavigate();
    const { user } = useAuth();
    // lidos dentro dos handlers sem recriar a conexão
    const userId = useRef<number | null>(null);
    const navigateRef = useRef(navigate);
    useEffect(() => {
        userId.current = user?.id ?? null;
        navigateRef.current = navigate;
    }, [user, navigate]);

    useEffect(() => {
        const socket = io({ path: '/socket.io', transports: ['websocket', 'polling'] });

        const setState = ({ session, state }: StateEvent) => {
            queryClient.setQueryData<Session[]>(['sessions'], sessions =>
                sessions?.map(item =>
                    item.name === session ? { ...item, state, hasQrcode: state === 'QRCODE' && item.hasQrcode } : item
                )
            );
            queryClient.setQueryData<Session>(['sessions', session], item =>
                item ? { ...item, state, hasQrcode: state === 'QRCODE' && item.hasQrcode } : item
            );
            if (state !== 'QRCODE') {
                setQrcodes(current => {
                    const next = { ...current };
                    delete next[session];
                    return next;
                });
            }
            queryClient.invalidateQueries({ queryKey: ['stats'] });
        };

        // várias mensagens em sequência: recarrega os números no máximo a cada 2s
        const refreshStats = () => {
            if (statsTimer.current) return;
            statsTimer.current = window.setTimeout(() => {
                statsTimer.current = undefined;
                queryClient.invalidateQueries({ queryKey: ['stats'] });
            }, 2000);
        };

        socket.on('connect', () => setConnected(true));
        socket.on('disconnect', () => setConnected(false));
        socket.on('connect_error', error => {
            setConnected(false);
            if (error.message === 'UNAUTHORIZED') queryClient.invalidateQueries({ queryKey: authStatusKey });
        });
        // estado de todas as sessões ao conectar/reconectar
        socket.on('sessions', (sessions: { name: string; state: string }[]) =>
            sessions.forEach(item => setState({ session: item.name, state: item.state }))
        );
        socket.on('session.state', setState);
        socket.on('session.qrcode', ({ session, qrcode }: { session: string; qrcode: string }) => {
            setQrcodes(current => ({ ...current, [session]: qrcode }));
            setState({ session, state: 'QRCODE' });
        });
        // lista de conversas: várias mensagens em sequência viram um único recarregamento
        const refreshLists = () => {
            if (listTimer.current) return;
            listTimer.current = window.setTimeout(() => {
                listTimer.current = undefined;
                queryClient.invalidateQueries({ queryKey: ['conversations'] });
            }, 400);
        };

        socket.on('message.saved', ({ message, conversation, contact }: SavedEvent) => {
            upsertMessage(queryClient, message);
            refreshLists();
            refreshStats();
            const forMe =
                conversation.status === 'pending' ||
                (conversation.status === 'open' && conversation.assignedUserId === userId.current);
            if (message.direction === 'in' && forMe) {
                notify(contactName(contact), preview(message) || 'Nova mensagem', () =>
                    navigateRef.current('/inbox/' + conversation.id)
                );
            }
        });
        socket.on('message.updated', ({ message }: { message: Message }) => upsertMessage(queryClient, message));
        socket.on('conversation.updated', ({ conversation }: { conversation: Conversation }) => {
            queryClient.setQueryData(['conversation', conversation.id], conversation);
            refreshLists();
            refreshStats();
        });
        // várias conversas mudaram de uma vez (bot desligado, grupos desligados)
        socket.on('conversations.changed', () => {
            refreshLists();
            refreshStats();
        });
        socket.on('contact.updated', () => {
            refreshLists();
            queryClient.invalidateQueries({ queryKey: ['conversation'] });
        });

        return () => {
            window.clearTimeout(statsTimer.current);
            window.clearTimeout(listTimer.current);
            socket.close();
        };
    }, [queryClient]);

    const value = useMemo(() => ({ connected, qrcodes }), [connected, qrcodes]);
    return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
