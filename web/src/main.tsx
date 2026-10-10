import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { App } from './App';
import { ApiError } from './lib/api';
import { authStatusKey } from './lib/auth';
import { applyTheme } from './lib/theme';
import './index.css';

applyTheme();

// 401 em qualquer chamada: o login expirou ou foi revogado; RequireAuth leva para /login
const onError = (error: Error) => {
    if (error instanceof ApiError && error.status === 401) {
        queryClient.invalidateQueries({ queryKey: authStatusKey });
    }
};

const queryClient = new QueryClient({
    queryCache: new QueryCache({ onError }),
    mutationCache: new MutationCache({ onError }),
    defaultOptions: {
        queries: {
            retry: (count, error) => !(error instanceof ApiError && error.status < 500) && count < 2,
            refetchOnWindowFocus: true
        }
    }
});

createRoot(document.getElementById('root')!).render(
    <StrictMode>
        <QueryClientProvider client={queryClient}>
            <BrowserRouter>
                <App />
            </BrowserRouter>
            <Toaster position="top-right" richColors closeButton />
        </QueryClientProvider>
    </StrictMode>
);
