import { Suspense, useState, type ReactNode } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router';
import {
    BookOpen,
    LayoutDashboard,
    LogOut,
    Menu,
    MessagesSquare,
    Monitor,
    Moon,
    PanelLeftClose,
    PanelLeftOpen,
    Send,
    Settings,
    Smartphone,
    Sparkles,
    Sun,
    Webhook,
    Workflow
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Dialog, SheetContent } from '@/components/ui/dialog';
import { Logo } from '@/components/logo';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipProvider } from '@/components/ui/tooltip';
import { useAuth, useLogout } from '@/lib/auth';
import { useStats } from '@/lib/queries';
import { useRealtime } from '@/lib/realtime-context';
import { useSidebarCollapsed } from '@/lib/sidebar';
import { useTheme, type Theme } from '@/lib/theme';
import { cn } from '@/lib/utils';

const ROLE_LABEL = { admin: 'Administrador', agent: 'Atendente', integration: 'Integração' };

// atalho para recolher/expandir, mostrado nas dicas
const SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘B' : 'Ctrl+B';

function Navigation({ collapsed, onNavigate }: { collapsed: boolean; onNavigate?: () => void }) {
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
                  { to: '/ai', label: 'Assistentes de IA', icon: Sparkles },
                  { to: '/send', label: 'Enviar mensagem', icon: Send },
                  { to: '/webhooks', label: 'Webhooks', icon: Webhook }
              ]
            : []),
        { to: '/settings', label: 'Configurações', icon: Settings }
    ];
    return (
        <nav className="grid gap-0.5" aria-label="Principal">
            {items.map(({ to, label, icon: Icon, end, badge }) => (
                <Tooltip key={to} content={badge ? `${label} · ${badge} na fila` : label} disabled={!collapsed}>
                    {/* o gatilho da dica fica num span: o NavLink usa className em função, que o asChild não mescla */}
                    <span className="block">
                        <NavLink
                            to={to}
                            end={end}
                            onClick={onNavigate}
                            aria-label={collapsed ? label : undefined}
                            className={({ isActive }) =>
                                cn(
                                    'relative flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-muted hover:text-foreground',
                                    collapsed && 'justify-center px-0',
                                    isActive && 'bg-primary-soft text-primary hover:bg-primary-soft hover:text-primary'
                                )
                            }
                        >
                            <Icon className="size-4 shrink-0" aria-hidden />
                            {!collapsed && <span className="flex-1 truncate">{label}</span>}
                            {badge ? (
                                <span
                                    className={cn(
                                        'rounded-full bg-warning-soft font-semibold text-warning',
                                        collapsed
                                            ? 'absolute top-0.5 right-1.5 min-w-4 px-1 text-center text-[10px] leading-4 ring-2 ring-card'
                                            : 'px-2 py-0.5 text-[11px]'
                                    )}
                                    title={collapsed ? undefined : `${badge} aguardando atendente`}
                                >
                                    <span className="sr-only">Aguardando atendente: </span>
                                    {badge}
                                </span>
                            ) : null}
                        </NavLink>
                    </span>
                </Tooltip>
            ))}
        </nav>
    );
}

const THEMES: { value: Theme; label: string; icon: typeof Sun }[] = [
    { value: 'light', label: 'Claro', icon: Sun },
    { value: 'dark', label: 'Escuro', icon: Moon },
    { value: 'system', label: 'Sistema', icon: Monitor }
];

function ThemeSwitcher({ collapsed }: { collapsed: boolean }) {
    const { theme, setTheme } = useTheme();
    if (collapsed) {
        // recolhido: um botão só, que passa para o próximo tema
        const index = THEMES.findIndex(item => item.value === theme);
        const current = THEMES[index];
        const next = THEMES[(index + 1) % THEMES.length];
        const Icon = current.icon;
        return (
            <Tooltip content={`Tema: ${current.label} (trocar para ${next.label.toLowerCase()})`}>
                <Button
                    variant="ghost"
                    size="icon"
                    className="mx-auto"
                    onClick={() => setTheme(next.value)}
                    aria-label={`Tema ${current.label}. Trocar para ${next.label}`}
                >
                    <Icon />
                </Button>
            </Tooltip>
        );
    }
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

function SidebarFooter({ collapsed }: { collapsed: boolean }) {
    const { user, principal } = useAuth();
    const { connected } = useRealtime();
    const logout = useLogout();
    const status = connected ? 'Tempo real conectado' : 'Reconectando…';
    const initial = (user?.name || '?').slice(0, 1).toUpperCase();

    if (collapsed) {
        return (
            <div className="grid justify-items-center gap-2 border-t pt-4">
                <Tooltip content={status}>
                    <span className="flex size-9 items-center justify-center" role="status" aria-label={status}>
                        <span
                            className={cn('size-2 rounded-full', connected ? 'bg-primary' : 'bg-warning')}
                            aria-hidden
                        />
                    </span>
                </Tooltip>
                <Tooltip content="Documentação da API">
                    <Button variant="ghost" size="icon" asChild>
                        <a href="/api/docs" target="_blank" rel="noreferrer" aria-label="Documentação da API">
                            <BookOpen />
                        </a>
                    </Button>
                </Tooltip>
                <ThemeSwitcher collapsed />
                {principal && (
                    <Tooltip content={`${user?.name ?? 'Acesso por token'} · ${ROLE_LABEL[principal.role]}`}>
                        <span
                            className="flex size-8 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary"
                            aria-label={`${user?.name ?? 'Acesso por token'}, ${ROLE_LABEL[principal.role]}`}
                            role="img"
                        >
                            {initial}
                        </span>
                    </Tooltip>
                )}
                {user && (
                    <Tooltip content="Sair">
                        <Button variant="ghost" size="icon" onClick={() => logout.mutate()} aria-label="Sair">
                            <LogOut />
                        </Button>
                    </Tooltip>
                )}
            </div>
        );
    }

    return (
        <div className="grid gap-3 border-t pt-4">
            <div className="flex items-center gap-2 px-1 text-xs text-muted-foreground" role="status">
                <span className={cn('size-2 rounded-full', connected ? 'bg-primary' : 'bg-warning')} aria-hidden />
                {status}
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
            <ThemeSwitcher collapsed={false} />
            {principal && (
                <div className="flex items-center gap-2">
                    <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                        {initial}
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

function Sidebar({
    collapsed = false,
    onToggle,
    onNavigate
}: {
    collapsed?: boolean;
    onToggle?: () => void;
    onNavigate?: () => void;
}) {
    const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose;
    const toggleLabel = collapsed ? 'Expandir menu' : 'Recolher menu';
    return (
        <div
            className={cn(
                'flex h-full flex-col gap-6 overflow-x-hidden overflow-y-auto py-4',
                collapsed ? 'px-3' : 'px-4'
            )}
        >
            <div className={cn('flex items-center gap-2', collapsed ? 'flex-col' : 'justify-between pl-2')}>
                <Logo className="pt-1" compact={collapsed} />
                {onToggle && (
                    <Tooltip content={`${toggleLabel} (${SHORTCUT})`} side={collapsed ? 'right' : 'bottom'}>
                        <Button
                            variant="ghost"
                            size="icon"
                            className="size-8 text-muted-foreground"
                            onClick={onToggle}
                            aria-label={toggleLabel}
                            aria-expanded={!collapsed}
                        >
                            <ToggleIcon />
                        </Button>
                    </Tooltip>
                )}
            </div>
            <div className="flex-1">
                <Navigation collapsed={collapsed} onNavigate={onNavigate} />
            </div>
            <SidebarFooter collapsed={collapsed} />
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
    const { collapsed, toggle } = useSidebarCollapsed();
    const location = useLocation();
    // o atendimento ocupa a tela toda (lista + conversa + contato)
    const wide = location.pathname.startsWith('/inbox') || /^\/flows\/\d+/.test(location.pathname);
    return (
        <TooltipProvider delayDuration={300}>
            <div
                className={cn(
                    'min-h-dvh lg:grid lg:transition-[grid-template-columns] lg:duration-200',
                    collapsed ? 'lg:grid-cols-[72px_1fr]' : 'lg:grid-cols-[248px_1fr]'
                )}
            >
                <aside className="sticky top-0 hidden h-dvh border-r bg-card lg:block" aria-label="Menu lateral">
                    <Sidebar collapsed={collapsed} onToggle={toggle} />
                </aside>
                <div className="min-w-0">
                    <OpenModeBanner />
                    <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b bg-card/90 px-4 backdrop-blur lg:hidden">
                        <Dialog open={menuOpen} onOpenChange={setMenuOpen}>
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={() => setMenuOpen(true)}
                                aria-label="Abrir menu"
                            >
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
        </TooltipProvider>
    );
}
