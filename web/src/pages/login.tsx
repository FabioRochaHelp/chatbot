import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { authStatusKey, useAuthStatus } from '@/lib/auth';
import { AuthLayout, FormError } from './auth-layout';

export function LoginPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const queryClient = useQueryClient();
    const status = useAuthStatus();
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    // página que a pessoa tentou abrir antes de ser mandada para o login
    const from = (location.state as { from?: string } | null)?.from || '/';

    const login = useMutation({
        mutationFn: () => api.post('/auth/login', { email, password }),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: authStatusKey });
            navigate(from, { replace: true });
        }
    });

    if (status.data?.setupRequired) return <Navigate to="/setup" replace />;
    if (status.data?.principal?.type === 'user') return <Navigate to={from} replace />;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        login.mutate();
    };
    const error = login.error instanceof ApiError ? login.error : null;

    return (
        <AuthLayout title="Entrar" description="Acesse o painel com seu e-mail e senha.">
            <form className="grid gap-4" onSubmit={submit} noValidate>
                <FormError message={error?.code === 'INVALID_PARAMS' ? 'Preencha e-mail e senha.' : error?.message} />
                <Field label="E-mail">
                    <Input
                        type="email"
                        autoComplete="username"
                        value={email}
                        onChange={event => setEmail(event.target.value)}
                        required
                        autoFocus
                    />
                </Field>
                <Field label="Senha">
                    <Input
                        type="password"
                        autoComplete="current-password"
                        value={password}
                        onChange={event => setPassword(event.target.value)}
                        required
                    />
                </Field>
                <Button type="submit" size="lg" loading={login.isPending} className="mt-1">
                    Entrar
                </Button>
            </form>
        </AuthLayout>
    );
}
