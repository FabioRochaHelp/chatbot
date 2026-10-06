import { Suspense, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import {
    BookOpen,
    Workflow,
    LayoutDashboard,
    LogOut,
    Menu,
    MessagesSquare,
    Monitor,
    Moon,
    Send,
    Settings,
    Smartphone,
    Sun
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, SheetContent } from '@/components/ui/dialog';
import { Logo } from '@/components/logo';
import { Skeleton } from '@/components/ui/skeleton';
import { useAuth, useLogout } from '@/lib/auth';
import { useStats } from '@/lib/queries';
import { useRealtime } from '@/lib/realtime-context';
import { useTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const ROLE_LABEL = { admin: 'Administrador', agent: 'Atendente', integration: 'Integração' };

function Navigation({ onNavigate }: { onNavigate?: () => void }) {
    const { canManage } = useAuth();
    const { data: stats } = useStats();
    const queue = stats?.conversations.pending ?? 0;
    const items = [
        { to: '/', label: 'Painel', icon: LayoutDashboard, end: true },
        { to: '/inbox', label: 'Atendimento', icon: MessagesSquare, badge: queue },
        { to: '/sessions', label: 'Sessões', icon: Smartphone },
        ...(canManage
            ? [
                  { to: '/flows', label: 'Fluxos', icon: Workflow },
                  { to: '/send', label: 'Enviar mensagem', icon: Send }
              ]
            : []),
        { to: '/settings', label: 'Configurações', icon: Settings }
    ];
    return (
        <nav className="grid gap-0.5" aria-label="Principal">
            {items.map(({ to, label, icon: Icon, end, badge }) => (
                <NavLink
                    key={to}
                    to={to}
                    end={end}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                        cn(
                            'flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                            isActive && 'bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary'
                        )
                    }
                >
                    <Icon className="size-4" aria-hidden />
                    <span className="flex-1">{label}</span>
                    {badge ? (
                        <span
                            className="rounded-full bg-warning-soft px-2 py-0.5 text-[11px] font-semibold text-warning"
                            title={`${badge} aguardando atendente`}
                        >
                            <span className="sr-only">Aguardando atendente: </span>
                            {badge}
                        </span>
                    ) : null}
                </NavLink>
            ))}
        </nav>
    );
}

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Claro', icon: Sun },
    { value: 'dark', label: 'Escuro', icon: Moon },
    { value: 'system', label: 'Sistema', icon: Monitor }
];

function ThemeSwitcher() {
    const { theme, setTheme } = useTheme();
    return (
        <div className="flex rounded-lg bg-muted p-0.5" role="radiogroup" aria-label="Tema">
            {THEMES.map(({ value, label, icon: Icon }) => (
                <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={theme === value}
                    title={label}
                    onClick={() => setTheme(value)}
                    className={cn(
                        'flex flex-1 items-center justify-center rounded-md py-1 text-muted-foreground transition-colors hover:text-foreground',
                        theme === value && 'bg-card text-foreground shadow-xs'
                    )}
                >
                    <Icon className="size-3.5" aria-hidden />
                    <span className="sr-only">{label}</span>
                </button>
            ))}
        </div>
    );
}

function SidebarFooter() {
    const { user, principal } = useAuth();
    const { connected } = useRealtime();
    const logout = useLogout();
    return (
        <div className="grid gap-3 border-t pt-4">
            <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground" role="status">
                <span className={cn('size-2 rounded-full', connected ? 'bg-primary' : 'bg-warning')} aria-hidden />
                {connected ? 'Tempo real conectado' : 'Reconectando…'}
            </div>
            <a
                href="/api/docs"
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-2 px-1 text-xs text-muted-foreground hover:text-foreground"
            >
                <BookOpen className="size-3.5" aria-hidden />
                Documentação da API
            </a>
            <ThemeSwitcher />
            {principal && (
                <div className="flex items-center gap-2">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                        {(user?.name || '?').slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium">{user?.name ?? 'Acesso por token'}</p>
                        <p className="truncate text-xs text-muted-foreground">{ROLE_LABEL[principal.role]}</p>
                    </div>
                    {user && (
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => logout.mutate()}
                            aria-label="Sair"
                            title="Sair"
                        >
                            <LogOut />
                        </Button>
                    )}
                </div>
            )}
        </div>
    );
}

function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
    return (
        <div className="flex h-full flex-col gap-6 p-4">
            <Logo className="px-2 pt-1" />
            <div className="flex-1">
                <Navigation onNavigate={onNavigate} />
            </div>
            <SidebarFooter />
        </div>
    );
}

function OpenModeBanner(): ReactNode {
    const { isOpenMode } = useAuth();
    if (!isOpenMode) return null;
    return (
        <div className="border-b bg-warning-soft px-4 py-2 text-center text-[13px] text-warning" role="alert">
            A API está sem autenticação. Crie o primeiro administrador para protegê-la.
        </div>
    );
}

function PageSkeleton() {
    return (
        <div className="grid gap-4" role="status" aria-label="Carregando">
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-64 rounded-xl" />
        </div>
    );
}

export function AppShell() {
    const [menuOpen, setMenuOpen] = useState(false);
    const location = useLocation();
    // o atendimento ocupa a tela toda (lista + conversa + contato)
    const wide = location.pathname.startsWith('/inbox') || /^\/flows\/\d+/.test(location.pathname);
    return (
        <div className="min-h-dvh lg:grid lg:grid-cols-[248px_1fr]">
            <aside className="sticky top-0 hidden h-dvh border-r bg-card lg:block">
                <Sidebar />
            </aside>
            <div className="min-w-0">
                <OpenModeBanner />
                <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-card/90 px-4 backdrop-blur lg:hidden">
                    <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
                        <Button variant="ghost" size="icon" onClick={() => setMenuOpen(true)} aria-label="Abrir menu">
                            <Menu />
                        </Button>
                        <SheetContent title="Menu">
                            <Sidebar onNavigate={() => setMenuOpen(false)} />
                        </SheetContent>
                    </Dialog>
                    <Logo />
                </header>
                <main
                    key={location.pathname.startsWith('/inbox') ? 'inbox' : location.pathname}
                    className={wide ? 'w-full' : 'mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8'}
                >
                    <Suspense fallback={<PageSkeleton />}>
                        <Outlet />
                    </Suspense>
                </main>
            </div>
        </div>
    );
}
