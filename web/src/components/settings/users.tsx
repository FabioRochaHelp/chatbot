import { useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { User } from '@/lib/types';
import { relativeTime } from '@/lib/utils';

type Form = { name: string; email: string; password: string; role: 'admin' | 'agent'; active: boolean };

function UserDialog({
    user,
    open,
    onOpenChange
}: {
    user: User | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const queryClient = useQueryClient();
    const editing = Boolean(user);
    const [form, setForm] = useState<Form>({ name: '', email: '', password: '', role: 'agent', active: true });
    const [seed, setSeed] = useState<User | null | undefined>(undefined);
    // reinicia o formulário ao abrir para outro usuário
    if (open && seed !== user) {
        setSeed(user);
        setForm(
            user
                ? { name: user.name, email: user.email, password: '', role: user.role, active: user.active }
                : { name: '', email: '', password: '', role: 'agent', active: true }
        );
    }

    const save = useMutation({
        mutationFn: () =>
            user
                ? api.patch<User>('/users/' + user.id, {
                      name: form.name,
                      role: form.role,
                      active: form.active,
                      ...(form.password ? { password: form.password } : {})
                  })
                : api.post<User>('/users', {
                      name: form.name,
                      email: form.email,
                      password: form.password,
                      role: form.role
                  }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            toast.success(editing ? 'Usuário atualizado' : 'Usuário criado');
            onOpenChange(false);
        }
    });
    const error = save.error instanceof ApiError ? save.error : null;
    const fields = error?.fieldErrors ?? {};

    const submit = (event: FormEvent) => {
        event.preventDefault();
        save.mutate();
    };

    return (
        <Dialog
            open={open}
            onOpenChange={next => {
                onOpenChange(next);
                if (!next) {
                    save.reset();
                    setSeed(undefined);
                }
            }}
        >
            <DialogContent
                title={editing ? 'Editar usuário' : 'Novo usuário'}
                description={
                    editing
                        ? undefined
                        : 'Passe o e-mail e a senha para a pessoa; ela pode trocar a senha em Minha conta.'
                }
            >
                <form className="grid gap-4" onSubmit={submit} noValidate>
                    {error && error.code !== 'INVALID_PARAMS' && (
                        <p
                            className="rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive first-letter:uppercase"
                            role="alert"
                        >
                            {error.message}
                        </p>
                    )}
                    <Field label="Nome" error={fields.name}>
                        <Input
                            value={form.name}
                            onChange={event => setForm({ ...form, name: event.target.value })}
                            autoFocus
                        />
                    </Field>
                    {!editing && (
                        <Field label="E-mail" error={fields.email && 'E-mail inválido'}>
                            <Input
                                type="email"
                                value={form.email}
                                onChange={event => setForm({ ...form, email: event.target.value })}
                            />
                        </Field>
                    )}
                    <Field
                        label={editing ? 'Nova senha (opcional)' : 'Senha'}
                        hint={
                            editing ? 'Trocar a senha encerra os logins ativos da pessoa.' : 'Mínimo de 8 caracteres.'
                        }
                        error={fields.password}
                    >
                        <Input
                            type="password"
                            autoComplete="new-password"
                            value={form.password}
                            onChange={event => setForm({ ...form, password: event.target.value })}
                        />
                    </Field>
                    <Field
                        label="Papel"
                        hint={
                            form.role === 'admin'
                                ? 'Acesso total.'
                                : 'Atende conversas; não gerencia sessões nem usuários.'
                        }
                    >
                        <Select
                            value={form.role}
                            onChange={event => setForm({ ...form, role: event.target.value as Form['role'] })}
                        >
                            <option value="agent">Atendente</option>
                            <option value="admin">Administrador</option>
                        </Select>
                    </Field>
                    {editing && (
                        <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
                            <span>
                                <span className="block text-sm font-medium">Ativo</span>
                                <span className="block text-[13px] text-muted-foreground">
                                    Desativar impede o login.
                                </span>
                            </span>
                            <Switch
                                checked={form.active}
                                onCheckedChange={active => setForm({ ...form, active })}
                                aria-label="Ativo"
                            />
                        </label>
                    )}
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit" loading={save.isPending}>
                            {editing ? 'Salvar' : 'Criar usuário'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export function UsersSettings() {
    const queryClient = useQueryClient();
    const { user: me } = useAuth();
    const { data: users, isLoading } = useQuery({
        queryKey: ['users', 'all'],
        queryFn: () => api.get<User[]>('/users')
    });
    const [editing, setEditing] = useState<User | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [removing, setRemoving] = useState<User | null>(null);

    const remove = useMutation({
        mutationFn: (user: User) => api.delete('/users/' + user.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['users'] });
            toast.success('Usuário removido');
            setRemoving(null);
        },
        onError: error => toast.error(error instanceof ApiError ? error.message : 'Não foi possível remover.')
    });

    return (
        <section className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                    Quem acessa o painel. Atendentes só veem conversas e contatos.
                </p>
                <Button
                    onClick={() => {
                        setEditing(null);
                        setDialogOpen(true);
                    }}
                >
                    <Plus /> Novo usuário
                </Button>
            </div>
            {isLoading ? (
                <Skeleton className="h-40 rounded-xl" />
            ) : (
                <ul className="divide-y rounded-xl border bg-card">
                    {users?.map(user => (
                        <li key={user.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                            <div className="min-w-0 flex-1">
                                <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                                    {user.name}
                                    {user.id === me?.id && (
                                        <span className="text-xs font-normal text-muted-foreground">(você)</span>
                                    )}
                                    <Badge tone={user.role === 'admin' ? 'info' : 'neutral'}>
                                        {user.role === 'admin' ? 'Administrador' : 'Atendente'}
                                    </Badge>
                                    {!user.active && <Badge tone="danger">Desativado</Badge>}
                                </p>
                                <p className="truncate text-[13px] text-muted-foreground">
                                    {user.email} ·{' '}
                                    {user.lastLoginAt
                                        ? `último acesso ${relativeTime(user.lastLoginAt)}`
                                        : 'nunca entrou'}
                                </p>
                            </div>
                            <div className="flex gap-1">
                                <Button
                                    variant="ghost"
                                    size="icon"
                                    aria-label={`Editar ${user.name}`}
                                    onClick={() => {
                                        setEditing(user);
                                        setDialogOpen(true);
                                    }}
                                >
                                    <Pencil />
                                </Button>
                                {user.id !== me?.id && (
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={`Remover ${user.name}`}
                                        onClick={() => setRemoving(user)}
                                    >
                                        <Trash2 />
                                    </Button>
                                )}
                            </div>
                        </li>
                    ))}
                </ul>
            )}
            <UserDialog user={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
            <Dialog open={Boolean(removing)} onOpenChange={open => !open && setRemoving(null)}>
                <DialogContent
                    title={`Remover ${removing?.name}?`}
                    description="A pessoa perde o acesso na hora. As mensagens que ela enviou continuam no histórico, sem o nome. Para só bloquear o acesso, prefira desativar."
                >
                    <div className="flex justify-end gap-2">
                        <Button variant="outline" onClick={() => setRemoving(null)}>
                            Cancelar
                        </Button>
                        <Button
                            variant="destructive"
                            loading={remove.isPending}
                            onClick={() => removing && remove.mutate(removing)}
                        >
                            Remover
                        </Button>
                    </div>
                </DialogContent>
            </Dialog>
        </section>
    );
}
