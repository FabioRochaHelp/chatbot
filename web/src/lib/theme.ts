import { useCallback, useEffect, useState } from 'react';

export type Theme = 'light' | 'dark' | 'system';
const KEY = 'myzap-theme';

function stored(): Theme {
    try {
        const value = localStorage.getItem(KEY);
        return value === 'light' || value === 'dark' ? value : 'system';
    } catch {
        return 'system';
    }
}

const media = () => window.matchMedia('(prefers-color-scheme: dark)');

export function applyTheme(theme: Theme = stored()) {
    const dark = theme === 'dark' || (theme === 'system' && media().matches);
    document.documentElement.classList.toggle('dark', dark);
}

export function useTheme() {
    const [theme, setThemeState] = useState<Theme>(stored);

    useEffect(() => {
        applyTheme(theme);
        if (theme !== 'system') return;
        const query = media();
        const listener = () => applyTheme('system');
        query.addEventListener('change', listener);
        return () => query.removeEventListener('change', listener);
    }, [theme]);

    const setTheme = useCallback((next: Theme) => {
        try {
            if (next === 'system') localStorage.removeItem(KEY);
            else localStorage.setItem(KEY, next);
        } catch {
            // sem storage (aba privada): vale só nesta página
        }
        setThemeState(next);
    }, []);

    return { theme, setTheme };
}
