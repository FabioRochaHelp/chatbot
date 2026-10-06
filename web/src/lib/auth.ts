import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { AuthStatus } from './types';

export const authStatusKey = ['auth', 'status'];

export function useAuthStatus() {
    return useQuery({ queryKey: authStatusKey, queryFn: () => api.get<AuthStatus>('/auth/status'), staleTime: 60000 });
}

/** Quem está logado e o que pode fazer. */
export function useAuth() {
    const { data } = useAuthStatus();
    const principal = data?.principal ?? null;
    return {
        principal,
        user: principal?.user ?? null,
        // atendente só consulta sessões; admin/integração gerenciam
        canManage: principal ? principal.role !== 'agent' : false,
        isOpenMode: principal?.type === 'open'
    };
}

export function useLogout() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: () => api.post('/auth/logout'),
        onSettled: () => {
            queryClient.clear();
            window.location.assign('/login');
        }
    });
}
