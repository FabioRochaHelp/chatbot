import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { DirectoryUser, QuickReply, Session, Stats } from './types';

export function useSessions() {
    return useQuery({ queryKey: ['sessions'], queryFn: () => api.get<Session[]>('/sessions') });
}

export function useSession(name: string) {
    return useQuery({
        queryKey: ['sessions', name],
        queryFn: () => api.get<Session>('/sessions/' + encodeURIComponent(name))
    });
}

export function useStats() {
    return useQuery({
        queryKey: ['stats'],
        queryFn: () => api.get<Stats>('/stats?tzOffset=' + new Date().getTimezoneOffset()),
        refetchInterval: 60000
    });
}

export function useDirectory() {
    return useQuery({
        queryKey: ['users', 'directory'],
        queryFn: () => api.get<DirectoryUser[]>('/users/directory'),
        staleTime: 60000
    });
}

export function useQuickReplies() {
    return useQuery({
        queryKey: ['quick-replies'],
        queryFn: () => api.get<QuickReply[]>('/quick-replies'),
        staleTime: 60000
    });
}
