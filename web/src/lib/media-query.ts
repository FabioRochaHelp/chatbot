import { useSyncExternalStore } from 'react';

/** true enquanto a media query casar (atualiza ao redimensionar). */
export function useMediaQuery(query: string) {
    return useSyncExternalStore(
        callback => {
            const list = window.matchMedia(query);
            list.addEventListener('change', callback);
            return () => list.removeEventListener('change', callback);
        },
        () => window.matchMedia(query).matches
    );
}
