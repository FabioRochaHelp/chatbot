import { useQuery } from '@tanstack/react-query';
import { api } from './api';
import type { AiAgent, AiStatus } from './ai-types';

export const useAiStatus = () =>
    useQuery({ queryKey: ['ai', 'status'], queryFn: () => api.get<AiStatus>('/ai/status'), staleTime: 60000 });
export const useAiAgents = () => useQuery({ queryKey: ['ai-agents'], queryFn: () => api.get<AiAgent[]>('/ai-agents') });
