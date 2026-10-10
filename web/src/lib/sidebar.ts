import { useCallback, useEffect, useState } from 'react';

const KEY = 'conectzap-sidebar-collapsed';
// nome antigo do app (MyZap): lido se ainda não houver a chave nova
const OLD_KEY = 'myzap-sidebar-collapsed';

function stored() {
    try {
        return (localStorage.getItem(KEY) ?? localStorage.getItem(OLD_KEY)) === '1';
    } catch {
        return false;
    }
}

/** Menu lateral recolhido (só ícones). Fica salvo no navegador; Ctrl/⌘+B alterna. */
export function useSidebarCollapsed() {
    const [collapsed, setCollapsed] = useState(stored);

    const toggle = useCallback(() => {
        setCollapsed(current => {
            const next = !current;
            try {
                localStorage.setItem(KEY, next ? '1' : '0');
            } catch {
                // sem storage (aba privada): vale só nesta página
            }
            return next;
        });
    }, []);

    useEffect(() => {
        const onKey = (event: KeyboardEvent) => {
            if (event.key.toLowerCase() !== 'b' || !(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey)
                return;
            // não atrapalha o negrito de quem está digitando
            const target = event.target as HTMLElement | null;
            if (target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return;
            event.preventDefault();
            toggle();
        };
        window.addEventListener('keydown', onKey);
        return () => window.removeEventListener('keydown', onKey);
    }, [toggle]);

    return { collapsed, toggle };
}
