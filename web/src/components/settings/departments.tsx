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
import type { Department, DepartmentMode, User } from '@/lib/types';
import { cn } from '@/lib/utils';

type Form = { name: string; mode: DepartmentMode; active: boolean; userIds: number[] };

export const MODE_LABEL: Record<DepartmentMode, string> = { esteira: 'Esteira', distribuida: 'Distribuída' };

const MODE_HINT: Record<DepartmentMode, string> = {
    esteira: 'O atendente escolhe na fila do departamento quem vai atender.',
    distribuida:
        'O sistema entrega as conversas em rodízio para os atendentes com o painel aberto e “Disponível” ligado.'
};

function DepartmentDialog({
    department,
    open,
    onOpenChange
}: {
    department: Department | null;
    open: boolean;
    onOpenChange: (open: boolean) => void;
}) {
    const queryClient = useQueryClient();
    const editing = Boolean(department);
    const { data: users } = useQuery({ queryKey: ['users', 'all'], queryFn: () => api.get<User[]>('/users') });
    const [form, setForm] = useState<Form>({ name: '', mode: 'esteira', active: true, userIds: [] });
    const [seed, setSeed] = useState<Department | null | undefined>(undefined);
    // reinicia o formulário ao abrir para outro departamento
    if (open && seed !== department) {
        setSeed(department);
        setForm(
            department
                ? {
                      name: department.name,
                      mode: department.mode,
                      active: department.active,
                      userIds: department.members.map(member => member.id)
                  }
                : { name: '', mode: 'esteira', active: true, userIds: [] }
        );
    }

    const save = useMutation({
        mutationFn: () =>
            department
                ? api.patch<Department>('/departments/' + department.id, form)
                : api.post<Department>('/departments', { name: form.name, mode: form.mode, userIds: form.userIds }),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['departments'] });
            toast.success(editing ? 'Departamento atualizado' : 'Departamento criado');
            onOpenChange(false);
        }
    });
    const error = save.error instanceof ApiError ? save.error : null;
    const fields = error?.fieldErrors ?? {};

    const submit = (event: FormEvent) => {
        event.preventDefault();
        save.mutate();
    };
    const toggleUser = (id: number) =>
        setForm({
            ...form,
            userIds: form.userIds.includes(id) ? form.userIds.filter(item => item !== id) : [...form.userIds, id]
        });
    const candidates = (users ?? []).filter(user => user.active || form.userIds.includes(user.id));

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
            <DialogContent title={editing ? 'Editar departamento' : 'Novo departamento'}>
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
                            placeholder="Ex.: Vendas, Suporte, Financeiro"
                            autoFocus
                        />
                    </Field>
                    <Field label="Modo de atendimento" hint={MODE_HINT[form.mode]}>
                        <Select
                            value={form.mode}
                            onChange={event => setForm({ ...form, mode: event.target.value as DepartmentMode })}
                        >
                            <option value="esteira">Esteira (o atendente escolhe)</option>
                            <option value="distribuida">Distribuída (rodízio automático)</option>
                        </Select>
                    </Field>
                    <fieldset className="grid gap-2">
                        <legend className="mb-1.5 text-sm font-medium">Atendentes</legend>
                        {candidates.length === 0 ? (
                            <p className="text-[13px] text-muted-foreground">Nenhum usuário cadastrado.</p>
                        ) : (
                            <ul className="max-h-56 divide-y overflow-y-auto rounded-lg border">
                                {candidates.map(user => (
                                    <li key={user.id}>
                                        <label className="flex cursor-pointer items-center gap-3 px-3 py-2 text-sm">
                                            <input
                                                type="checkbox"
                                                className="size-4 accent-primary"
                                                checked={form.userIds.includes(user.id)}
                                                onChange={() => toggleUser(user.id)}
                                            />
                                            <span className="flex-1 truncate">{user.name}</span>
                                            {user.role === 'admin' && <Badge tone="info">Administrador</Badge>}
                                        </label>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </fieldset>
                    {editing && (
                        <label className="flex items-center justify-between gap-4 rounded-lg border p-3">
                            <span>
                                <span className="block text-sm font-medium">Ativo</span>
                                <span className="block text-[13px] text-muted-foreground">
                                    Desativar move a fila para “Sem departamento”.
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
                            {editing ? 'Salvar' : 'Criar departamento'}
                        </Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}

export function DepartmentsSettings() {
    const queryClient = useQueryClient();
    const { data: departments, isLoading } = useQuery({
        queryKey: ['departments', 'all'],
        queryFn: () => api.get<Department[]>('/departments?active=all')
    });
    const [editing, setEditing] = useState<Department | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [removing, setRemoving] = useState<Department | null>(null);

    const remove = useMutation({
        mutationFn: (department: Department) => api.delete('/departments/' + department.id),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['departments'] });
            queryClient.invalidateQueries({ queryKey: ['conversations'] });
            toast.success('Departamento removido');
            setRemoving(null);
        },
        onError: error => toast.error(error instanceof ApiError ? error.message : 'Não foi possível remover.')
    });

    return (
        <section className="grid gap-4">
            <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm text-muted-foreground">
                    Filas de atendimento. Cada atendente vê só as filas dos seus departamentos.
                </p>
                <Button
                    onClick={() => {
                        setEditing(null);
                        setDialogOpen(true);
                    }}
                >
                    <Plus /> Novo departamento
                </Button>
            </div>
            {isLoading ? (
                <Skeleton className="h-40 rounded-xl" />
            ) : departments?.length === 0 ? (
                <p className="rounded-xl border bg-card px-4 py-8 text-center text-sm text-muted-foreground">
                    Nenhum departamento. Sem departamentos, todas as conversas ficam numa fila única.
                </p>
            ) : (
                <ul className="divide-y rounded-xl border bg-card">
                    {departments?.map(department => {
                        const online = department.members.filter(member => member.online).length;
                        return (
                            <li key={department.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                                <div className="min-w-0 flex-1">
                                    <p className="flex flex-wrap items-center gap-2 text-sm font-medium">
                                        {department.name}
                                        <Badge tone={department.mode === 'distribuida' ? 'info' : 'neutral'}>
                                            {MODE_LABEL[department.mode]}
                                        </Badge>
                                        {!department.active && <Badge tone="danger">Desativado</Badge>}
                                        {department.pending > 0 && (
                                            <Badge tone="warning">{department.pending} na fila</Badge>
                                        )}
                                    </p>
                                    <p className="mt-1 flex flex-wrap gap-x-3 gap-y-1 text-[13px] text-muted-foreground">
                                        {department.members.length === 0
                                            ? 'Sem atendentes'
                                            : department.members.map(member => (
                                                  <span key={member.id} className="inline-flex items-center gap-1.5">
                                                      <span
                                                          className={cn(
                                                              'size-2 rounded-full',
                                                              member.online ? 'bg-primary' : 'bg-muted-foreground/40'
                                                          )}
                                                          aria-hidden
                                                      />
                                                      {member.name}
                                                      <span className="sr-only">
                                                          {member.online ? '(on-line)' : '(off-line)'}
                                                      </span>
                                                  </span>
                                              ))}
                                    </p>
                                    {department.mode === 'distribuida' && department.members.length > 0 && (
                                        <p className="mt-1 text-xs text-muted-foreground">
                                            {online === 0
                                                ? 'Ninguém disponível: as conversas esperam na fila.'
                                                : `${online} disponível${online > 1 ? 'is' : ''} no rodízio`}
                                        </p>
                                    )}
                                </div>
                                <div className="flex gap-1">
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={`Editar ${department.name}`}
                                        onClick={() => {
                                            setEditing(department);
                                            setDialogOpen(true);
                                        }}
                                    >
                                        <Pencil />
                                    </Button>
                                    <Button
                                        variant="ghost"
                                        size="icon"
                                        aria-label={`Remover ${department.name}`}
                                        onClick={() => setRemoving(department)}
                                    >
                                        <Trash2 />
                                    </Button>
                                </div>
                            </li>
                        );
                    })}
                </ul>
            )}
            <DepartmentDialog department={editing} open={dialogOpen} onOpenChange={setDialogOpen} />
            <Dialog open={Boolean(removing)} onOpenChange={open => !open && setRemoving(null)}>
                <DialogContent
                    title={`Remover ${removing?.name}?`}
                    description="As conversas do departamento vão para “Sem departamento”. Fluxos e assistentes que transferiam para ele passam a usar essa fila. Para só pausar, prefira desativar."
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
