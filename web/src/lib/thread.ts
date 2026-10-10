import type { InfiniteData, QueryClient } from '@tanstack/react-query';
import type { Message } from './types';

export type ThreadPage = { data: Message[]; meta: { hasMore: boolean } };
export type ThreadData = InfiniteData<ThreadPage, number | undefined>;

export const threadKey = (conversationId: number) => ['messages', conversationId];

/** Insere ou atualiza a mensagem no histórico em cache (página 0 = mais recente). */
export function upsertMessage(queryClient: QueryClient, message: Message) {
    queryClient.setQueryData<ThreadData>(threadKey(message.conversationId), data => {
        if (!data) return data;
        let found = false;
        const pages = data.pages.map(page => ({
            ...page,
            data: page.data.map(item => {
                if (item.id !== message.id) return item;
                found = true;
                return { ...item, ...message };
            })
        }));
        if (!found && pages.length > 0) pages[0] = { ...pages[0], data: [...pages[0].data, message] };
        return { ...data, pages };
    });
}
