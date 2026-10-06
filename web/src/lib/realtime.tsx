import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { authStatusKey } from './auth';
import { RealtimeContext } from './realtime-context';
import type { Session } from './types';

type StateEvent = { session: string; state: string };

/** Uma conexão Socket.IO por aba; os eventos atualizam o cache do React Query. */
export function RealtimeProvider({ children }: { children: ReactNode }) {
    const queryClient = useQueryClient();
    const [connected, setConnected] = useState(false);
    const [qrcodes, setQrcodes] = useState<Record<string, string>>({});
    const statsTimer = useRef<number | undefined>(undefined);

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
        socket.on('message.saved', refreshStats);
        socket.on('conversation.updated', refreshStats);

        return () => {
            window.clearTimeout(statsTimer.current);
            socket.close();
        };
    }, [queryClient]);

    const value = useMemo(() => ({ connected, qrcodes }), [connected, qrcodes]);
    return <RealtimeContext.Provider value={value}>{children}</RealtimeContext.Provider>;
}
