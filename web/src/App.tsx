import { lazy, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { LoaderCircle } from 'lucide-react';
import { AppShell } from '@/components/app-shell';
import { useAuth, useAuthStatus } from '@/lib/auth';
import { RealtimeProvider } from '@/lib/realtime';
import { LoginPage } from '@/pages/login';
import { SetupPage } from '@/pages/setup';

// páginas do painel carregadas sob demanda (login/setup ficam no bundle inicial)
const DashboardPage = lazy(() => import('@/pages/dashboard').then(m => ({ default: m.DashboardPage })));
const SessionsPage = lazy(() => import('@/pages/sessions').then(m => ({ default: m.SessionsPage })));
const SessionDetailPage = lazy(() => import('@/pages/session-detail').then(m => ({ default: m.SessionDetailPage })));
const SendPage = lazy(() => import('@/pages/send').then(m => ({ default: m.SendPage })));
const NotFoundPage = lazy(() => import('@/pages/not-found').then(m => ({ default: m.NotFoundPage })));

function Splash() {
    return (
        <div className="flex min-h-dvh items-center justify-center" role="status">
            <LoaderCircle className="size-6 animate-spin text-muted-foreground" aria-label="Carregando" />
        </div>
    );
}

/** Exige login (ou setup) antes do painel; o tempo real só conecta depois disso. */
function RequireAuth() {
    const status = useAuthStatus();
    const location = useLocation();
    if (status.isLoading) return <Splash />;
    if (status.isError || !status.data) {
        return (
            <div className="flex min-h-dvh items-center justify-center px-4 text-center text-sm text-muted-foreground">
                Não foi possível falar com o servidor. Verifique se o MyZap está rodando e recarregue a página.
            </div>
        );
    }
    if (status.data.setupRequired) return <Navigate to="/setup" replace />;
    if (!status.data.principal)
        return <Navigate to="/login" replace state={{ from: location.pathname + location.search }} />;
    return (
        <RealtimeProvider>
            <AppShell />
        </RealtimeProvider>
    );
}

function ManagersOnly({ children }: { children: ReactNode }) {
    const { canManage } = useAuth();
    return canManage ? children : <Navigate to="/" replace />;
}

export function App() {
    return (
        <Routes>
            <Route path="/login" element={<LoginPage />} />
            <Route path="/setup" element={<SetupPage />} />
            <Route element={<RequireAuth />}>
                <Route index element={<DashboardPage />} />
                <Route path="sessions" element={<SessionsPage />} />
                <Route path="sessions/:name" element={<SessionDetailPage />} />
                <Route
                    path="send"
                    element={
                        <ManagersOnly>
                            <SendPage />
                        </ManagersOnly>
                    }
                />
                <Route path="*" element={<NotFoundPage />} />
            </Route>
        </Routes>
    );
}
