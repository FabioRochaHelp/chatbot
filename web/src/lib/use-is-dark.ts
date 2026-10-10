import { useSyncExternalStore } from 'react';

/** Tema escuro efetivo (classe "dark" no <html>), acompanhando a troca de tema. */
export function useIsDark() {
    return useSyncExternalStore(
        callback => {
            const observer = new MutationObserver(callback);
            observer.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
            return () => observer.disconnect();
        },
        () => document.documentElement.classList.contains('dark')
    );
}
