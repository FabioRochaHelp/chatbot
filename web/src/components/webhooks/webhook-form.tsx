import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select } from '@/components/ui/input';
import { ApiError } from '@/lib/api';
import { useSessions } from '@/lib/queries';
import { EVENT_INFO, EVENTS, type WebhookEvent } from '@/lib/webhook-types';
import { cn } from '@/lib/utils';

export type WebhookForm = { url: string; session: string | null; events: WebhookEvent[] };

export function WebhookFields({
    initial,
    submitLabel,
    pending,
    error,
    legacy,
    onSubmit,
    onCancel
}: {
    initial: WebhookForm;
    submitLabel: string;
    pending: boolean;
    error: unknown;
    legacy?: boolean;
    onSubmit: (form: WebhookForm) => void;
    onCancel: () => void;
}) {
    const { data: sessions } = useSessions();
    const [form, setForm] = useState(initial);
    const fields = error instanceof ApiError ? error.fieldErrors : {};
    const general = error instanceof ApiError && error.code !== 'INVALID_PARAMS' ? error.message : null;
    const toggle = (event: WebhookEvent) =>
        setForm(current => ({
            ...current,
            events: current.events.includes(event)
                ? current.events.filter(item => item !== event)
                : [...current.events, event]
        }));

    return (
        <form
            className="grid gap-4"
            noValidate
            onSubmit={(event: FormEvent) => {
                event.preventDefault();
                onSubmit(form);
            }}
        >
            {general && (
                <p className="rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive first-letter:uppercase">
                    {general}
                </p>
            )}
            <Field
                label="URL"
                hint="Endereço do seu sistema que recebe os eventos (POST com JSON)."
                error={fields.url && 'URL http(s) inválida'}
            >
                <Input
                    type="url"
                    value={form.url}
                    onChange={event => setForm({ ...form, url: event.target.value })}
                    placeholder="https://seusistema.com/webhooks/myzap"
                    autoFocus
                />
            </Field>
            {!legacy && (
                <>
                    <Field label="Sessão">
                        <Select
                            value={form.session ?? ''}
                            onChange={event => setForm({ ...form, session: event.target.value || null })}
                        >
                            <option value="">Todas as sessões</option>
                            {sessions?.map(session => (
                                <option key={session.name} value={session.name}>
                                    {session.name}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    <fieldset className="grid gap-2">
                        <legend className="mb-1.5 text-sm font-medium">Eventos</legend>
                        {EVENTS.map(event => (
                            <label
                                key={event}
                                className={cn(
                                    'flex cursor-pointer items-start gap-3 rounded-lg border p-2.5 transition-colors hover:bg-muted/60',
                                    form.events.includes(event) && 'border-primary/50 bg-primary-soft/30'
                                )}
                            >
                                <input
                                    type="checkbox"
                                    className="mt-1 accent-[var(--primary)]"
                                    checked={form.events.includes(event)}
                                    onChange={() => toggle(event)}
                                />
                                <span>
                                    <span className="block text-sm font-medium">
                                        {EVENT_INFO[event].label}{' '}
                                        <code className="ml-1 text-[11px] font-normal text-muted-foreground">
                                            {event}
                                        </code>
                                    </span>
                                    <span className="block text-[13px] text-muted-foreground">
                                        {EVENT_INFO[event].description}
                                    </span>
                                </span>
                            </label>
                        ))}
                        {fields.events && <p className="text-[13px] text-destructive">Escolha ao menos um evento.</p>}
                    </fieldset>
                </>
            )}
            <div className="flex justify-end gap-2">
                <Button type="button" variant="outline" onClick={onCancel}>
                    Cancelar
                </Button>
                <Button type="submit" loading={pending}>
                    {submitLabel}
                </Button>
            </div>
        </form>
    );
}
