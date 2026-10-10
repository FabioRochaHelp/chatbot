import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { X } from 'lucide-react';
import { Avatar } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { api, ApiError } from '@/lib/api';
import { contactName, STATUS_LABEL } from '@/lib/contacts';
import type { Contact, Conversation } from '@/lib/types';
import { formatWaId } from '@/lib/utils';

/** Use com key={contact.id + nome}: o campo de nome reinicia quando o contato muda. */
export function ContactPanel({ conversation, onClose }: { conversation: Conversation; onClose: () => void }) {
    const queryClient = useQueryClient();
    const { contact } = conversation;
    const [name, setName] = useState(contact.name ?? '');
    const [tag, setTag] = useState('');

    const save = useMutation({
        mutationFn: (body: { name?: string | null; tags?: string[] }) =>
            api.patch<Contact>('/contacts/' + contact.id, body),
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: ['conversation', conversation.id] });
            queryClient.invalidateQueries({ queryKey: ['conversations'] });
        },
        onError: error => toast.error(error instanceof ApiError ? error.message : 'Não foi possível salvar.')
    });

    const addTag = (event: FormEvent) => {
        event.preventDefault();
        const value = tag.trim();
        if (!value || contact.tags.includes(value)) return setTag('');
        save.mutate({ tags: [...contact.tags, value] });
        setTag('');
    };

    const rows: [string, string][] = [
        ['Número', formatWaId(contact.waId)],
        ['Sessão', conversation.session],
        [
            'Situação',
            conversation.status === 'open' && conversation.assignedUser
                ? `Com ${conversation.assignedUser.name}`
                : STATUS_LABEL[conversation.status]
        ],
        [
            'Início da conversa',
            new Date(conversation.createdAt).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })
        ]
    ];

    return (
        <aside className="flex h-full w-full flex-col overflow-y-auto bg-card" aria-label="Detalhes do contato">
            <div className="flex items-center justify-between border-b px-4 py-3">
                <h2 className="text-sm font-semibold">Contato</h2>
                <Button variant="ghost" size="icon" className="size-8" onClick={onClose} aria-label="Fechar detalhes">
                    <X />
                </Button>
            </div>
            <div className="grid gap-5 p-4">
                <div className="flex flex-col items-center gap-2 text-center">
                    <Avatar name={contactName(contact)} group={contact.isGroup} className="size-16 text-lg" />
                    <p className="font-medium">{contactName(contact)}</p>
                    {contact.pushName && contact.name && (
                        <p className="-mt-1.5 text-xs text-muted-foreground">No WhatsApp: {contact.pushName}</p>
                    )}
                </div>

                <form
                    className="grid gap-2"
                    onSubmit={event => {
                        event.preventDefault();
                        save.mutate({ name: name.trim() || null }, { onSuccess: () => toast.success('Nome salvo') });
                    }}
                >
                    <Field label="Nome no painel" hint="Só a equipe vê este nome.">
                        <Input
                            value={name}
                            onChange={event => setName(event.target.value)}
                            placeholder={contact.pushName ?? ''}
                            maxLength={255}
                        />
                    </Field>
                    {name.trim() !== (contact.name ?? '') && (
                        <Button type="submit" size="sm" variant="outline" loading={save.isPending}>
                            Salvar nome
                        </Button>
                    )}
                </form>

                <div className="grid gap-2">
                    <p className="text-sm font-medium">Etiquetas</p>
                    {contact.tags.length > 0 && (
                        <ul className="flex flex-wrap gap-1.5">
                            {contact.tags.map(item => (
                                <li
                                    key={item}
                                    className="flex items-center gap-1 rounded-full bg-muted py-0.5 pr-1 pl-2.5 text-xs"
                                >
                                    {item}
                                    <button
                                        type="button"
                                        onClick={() =>
                                            save.mutate({ tags: contact.tags.filter(other => other !== item) })
                                        }
                                        className="rounded-full p-0.5 hover:bg-card"
                                        aria-label={`Remover etiqueta ${item}`}
                                    >
                                        <X className="size-3" />
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                    <form onSubmit={addTag}>
                        <Input
                            value={tag}
                            onChange={event => setTag(event.target.value)}
                            placeholder="Nova etiqueta e Enter"
                            maxLength={50}
                            aria-label="Nova etiqueta"
                            className="h-8"
                        />
                    </form>
                </div>

                <dl className="grid gap-3 border-t pt-4 text-sm">
                    {rows.map(([label, value]) => (
                        <div key={label}>
                            <dt className="text-xs text-muted-foreground">{label}</dt>
                            <dd className="font-medium break-words">{value}</dd>
                        </div>
                    ))}
                </dl>
            </div>
        </aside>
    );
}
