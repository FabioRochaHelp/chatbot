import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { authStatusKey, useAuth } from '@/lib/auth';

export function AccountSettings() {
    const queryClient = useQueryClient();
    const { user } = useAuth();
    const [name, setName] = useState(user?.name ?? '');
    const [passwords, setPasswords] = useState({ currentPassword: '', newPassword: '', confirm: '' });
    const [mismatch, setMismatch] = useState(false);

    const save = useMutation({
        mutationFn: (body: Record<string, string>) => api.patch('/auth/me', body),
        onSuccess: (_, body) => {
            queryClient.invalidateQueries({ queryKey: authStatusKey });
            toast.success(body.newPassword ? 'Senha alterada. Os outros logins foram encerrados.' : 'Nome salvo');
            if (body.newPassword) setPasswords({ currentPassword: '', newPassword: '', confirm: '' });
        }
    });
    const error = save.error instanceof ApiError ? save.error : null;

    if (!user) {
        return <p className="text-sm text-muted-foreground">Você entrou com um token; não há perfil para editar.</p>;
    }

    const changePassword = (event: FormEvent) => {
        event.preventDefault();
        const differs = passwords.newPassword !== passwords.confirm;
        setMismatch(differs);
        if (!differs) save.mutate({ currentPassword: passwords.currentPassword, newPassword: passwords.newPassword });
    };

    return (
        <div className="grid max-w-xl gap-4">
            <Card>
                <CardContent className="p-5">
                    <form
                        className="grid gap-4"
                        onSubmit={event => {
                            event.preventDefault();
                            save.mutate({ name });
                        }}
                    >
                        <Field label="Nome" hint={`Entra como ${user.email}`}>
                            <Input value={name} onChange={event => setName(event.target.value)} maxLength={100} />
                        </Field>
                        <Button
                            type="submit"
                            variant="outline"
                            className="justify-self-start"
                            disabled={!name.trim() || name === user.name}
                        >
                            Salvar nome
                        </Button>
                    </form>
                </CardContent>
            </Card>
            <Card>
                <CardContent className="p-5">
                    <form className="grid gap-4" onSubmit={changePassword} noValidate>
                        <h2 className="text-sm font-semibold">Trocar senha</h2>
                        <Field
                            label="Senha atual"
                            error={error?.code === 'INVALID_PASSWORD' ? 'Senha atual incorreta' : undefined}
                        >
                            <Input
                                type="password"
                                autoComplete="current-password"
                                value={passwords.currentPassword}
                                onChange={event => setPasswords({ ...passwords, currentPassword: event.target.value })}
                            />
                        </Field>
                        <Field label="Nova senha" hint="Mínimo de 8 caracteres." error={error?.fieldErrors.newPassword}>
                            <Input
                                type="password"
                                autoComplete="new-password"
                                value={passwords.newPassword}
                                onChange={event => setPasswords({ ...passwords, newPassword: event.target.value })}
                            />
                        </Field>
                        <Field label="Confirme a nova senha" error={mismatch ? 'As senhas não conferem' : undefined}>
                            <Input
                                type="password"
                                autoComplete="new-password"
                                value={passwords.confirm}
                                onChange={event => setPasswords({ ...passwords, confirm: event.target.value })}
                            />
                        </Field>
                        <Button
                            type="submit"
                            className="justify-self-start"
                            loading={save.isPending && Boolean(save.variables?.newPassword)}
                        >
                            Trocar senha
                        </Button>
                    </form>
                </CardContent>
            </Card>
        </div>
    );
}
