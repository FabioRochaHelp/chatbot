import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from './api';
import type { AuthStatus, User } from './types';

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

/** Liga/desliga o "Disponível" (receber conversas dos departamentos distribuídos). */
export function useAvailability() {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: (available: boolean) => api.patch<User>('/auth/me', { available }),
        onSuccess: user => {
            queryClient.setQueryData<AuthStatus>(authStatusKey, status =>
                status?.principal ? { ...status, principal: { ...status.principal, user } } : status
            );
            queryClient.invalidateQueries({ queryKey: ['departments'] });
        }
    });
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
