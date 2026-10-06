import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { authStatusKey, useAuthStatus } from '@/lib/auth';
import { AuthLayout, FormError } from './auth-layout';

export function SetupPage() {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const status = useAuthStatus();
    const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '', token: '' });
    const [mismatch, setMismatch] = useState(false);
    const set = (key: keyof typeof form) => (event: { target: { value: string } }) =>
        setForm(current => ({ ...current, [key]: event.target.value }));

    // com API_TOKEN definido a API já exige autenticação mesmo sem usuários
    const needsToken = Boolean(status.data?.authRequired);

    const setup = useMutation({
        mutationFn: () =>
            api.post(
                '/auth/setup',
                { name: form.name, email: form.email, password: form.password },
                { token: needsToken ? form.token : undefined }
            ),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: authStatusKey });
            navigate('/', { replace: true });
        }
    });

    if (status.data && !status.data.setupRequired) return <Navigate to="/login" replace />;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        const differs = form.password !== form.confirm;
        setMismatch(differs);
        if (!differs) setup.mutate();
    };
    const error = setup.error instanceof ApiError ? setup.error : null;
    const fields = error?.fieldErrors ?? {};

    return (
        <AuthLayout
            title="Configurar o MyZap"
            description="Crie a conta de administrador. Depois você poderá convidar atendentes."
        >
            <form className="grid gap-4" onSubmit={submit} noValidate>
                <FormError message={error && error.code !== 'INVALID_PARAMS' ? error.message : null} />
                <Field label="Seu nome" error={fields.name}>
                    <Input autoComplete="name" value={form.name} onChange={set('name')} required autoFocus />
                </Field>
                <Field label="E-mail" error={fields.email && 'E-mail inválido'}>
                    <Input type="email" autoComplete="username" value={form.email} onChange={set('email')} required />
                </Field>
                <Field label="Senha" hint="Mínimo de 8 caracteres." error={fields.password}>
                    <Input
                        type="password"
                        autoComplete="new-password"
                        value={form.password}
                        onChange={set('password')}
                        required
                    />
                </Field>
                <Field label="Confirme a senha" error={mismatch ? 'As senhas não conferem' : undefined}>
                    <Input
                        type="password"
                        autoComplete="new-password"
                        value={form.confirm}
                        onChange={set('confirm')}
                        required
                    />
                </Field>
                {needsToken && (
                    <Field label="API_TOKEN" hint="O valor de API_TOKEN do arquivo .env do servidor.">
                        <Input type="password" value={form.token} onChange={set('token')} required />
                    </Field>
                )}
                <Button type="submit" size="lg" loading={setup.isPending} className="mt-1">
                    Criar administrador
                </Button>
            </form>
        </AuthLayout>
    );
}
