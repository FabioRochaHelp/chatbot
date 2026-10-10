import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input, Textarea } from '@/components/ui/input';
import type { FlowSettings } from '@/lib/flow-types';

export function SettingsDialog({
    settings,
    open,
    onOpenChange,
    onSave
}: {
    settings: FlowSettings;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    onSave: (settings: FlowSettings) => void;
}) {
    const [form, setForm] = useState({ timeout: '', keywords: '', text: '' });
    const [seeded, setSeeded] = useState(false);
    if (open && !seeded) {
        setSeeded(true);
        setForm({
            timeout: String(settings.timeoutMinutes ?? 30),
            keywords: (settings.handoffKeywords ?? []).join(', '),
            text: settings.handoffText ?? ''
        });
    }
    return (
        <Dialog
            open={open}
            onOpenChange={next => {
                onOpenChange(next);
                if (!next) setSeeded(false);
            }}
        >
            <DialogContent title="Configurações do fluxo" description="Valem para todo o fluxo.">
                <form
                    className="grid gap-4"
                    onSubmit={event => {
                        event.preventDefault();
                        onSave({
                            timeoutMinutes: Math.min(1440, Math.max(1, Number(form.timeout) || 30)),
                            handoffKeywords: form.keywords
                                .split(',')
                                .map(word => word.trim())
                                .filter(Boolean)
                                .slice(0, 20),
                            handoffText: form.text.trim() || undefined
                        });
                        onOpenChange(false);
                        setSeeded(false);
                    }}
                >
                    <Field
                        label="Recomeçar após inatividade (minutos)"
                        hint="Se o contato demorar mais que isso para responder, o fluxo recomeça do início."
                    >
                        <Input
                            type="number"
                            min={1}
                            max={1440}
                            value={form.timeout}
                            onChange={event => setForm({ ...form, timeout: event.target.value })}
                        />
                    </Field>
                    <Field
                        label="Palavras para chamar um atendente"
                        hint="Separadas por vírgula. Em qualquer ponto do fluxo, transferem para a fila."
                    >
                        <Input
                            value={form.keywords}
                            onChange={event => setForm({ ...form, keywords: event.target.value })}
                            placeholder="atendente, humano"
                        />
                    </Field>
                    <Field label="Resposta ao transferir por palavra-chave (opcional)">
                        <Textarea
                            value={form.text}
                            onChange={event => setForm({ ...form, text: event.target.value })}
                            rows={2}
                        />
                    </Field>
                    <div className="flex justify-end gap-2">
                        <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
                            Cancelar
                        </Button>
                        <Button type="submit">Salvar</Button>
                    </div>
                </form>
            </DialogContent>
        </Dialog>
    );
}
