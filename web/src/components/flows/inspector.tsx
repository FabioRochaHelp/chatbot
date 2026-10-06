import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, Copy, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Switch } from '@/components/ui/switch';
import {
    NODE_META,
    WEEKDAYS,
    newId,
    type FlowNodeData,
    type FlowNodeType,
    type Rule,
    type Slot
} from '@/lib/flow-types';
import { cn } from '@/lib/utils';
import type { EditorNode } from './editor-context';

type Props = {
    node: EditorNode;
    variables: string[];
    issues?: string[];
    onChange: (data: FlowNodeData) => void;
    onDelete: () => void;
    onDuplicate: () => void;
    onClose: () => void;
};

const OPERATORS: { value: Rule['operator']; label: string }[] = [
    { value: 'contains', label: 'contém' },
    { value: 'equals', label: 'é igual a' },
    { value: 'startsWith', label: 'começa com' },
    { value: 'exists', label: 'foi preenchida' },
    { value: 'regex', label: 'casa com a expressão' }
];

const TIMEZONES = [
    'America/Sao_Paulo',
    'America/Manaus',
    'America/Cuiaba',
    'America/Belem',
    'America/Fortaleza',
    'America/Recife',
    'America/Bahia',
    'America/Rio_Branco',
    'America/Noronha'
];

const VARIABLE_HINT = 'Use {{contact.name}} para o nome do contato e {{variavel}} para respostas guardadas.';

function VariableChips({ variables }: { variables: string[] }) {
    const all = ['contact.name', 'contact.number', ...variables];
    return (
        <p className="flex flex-wrap gap-1 text-[11px] text-muted-foreground">
            {all.map(name => (
                <code key={name} className="rounded bg-muted px-1.5 py-0.5">{`{{${name}}}`}</code>
            ))}
        </p>
    );
}

function ListRow({
    children,
    onRemove,
    onUp,
    onDown,
    label
}: {
    children: ReactNode;
    onRemove?: () => void;
    onUp?: () => void;
    onDown?: () => void;
    label: string;
}) {
    return (
        <div className="flex items-start gap-1">
            <div className="min-w-0 flex-1">{children}</div>
            {onUp && (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9"
                    onClick={onUp}
                    aria-label={`Subir ${label}`}
                >
                    <ArrowUp />
                </Button>
            )}
            {onDown && (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9"
                    onClick={onDown}
                    aria-label={`Descer ${label}`}
                >
                    <ArrowDown />
                </Button>
            )}
            {onRemove && (
                <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9"
                    onClick={onRemove}
                    aria-label={`Remover ${label}`}
                >
                    <X />
                </Button>
            )}
        </div>
    );
}

function move<T>(list: T[], from: number, to: number) {
    const next = [...list];
    const [item] = next.splice(from, 1);
    next.splice(to, 0, item);
    return next;
}

function Body({
    type,
    data,
    set,
    variables
}: {
    type: FlowNodeType;
    data: FlowNodeData;
    set: (patch: Partial<FlowNodeData>) => void;
    variables: string[];
}) {
    switch (type) {
        case 'start':
            return (
                <p className="text-sm text-muted-foreground">
                    O fluxo começa quando um contato manda mensagem numa conversa com o bot. Ligue este bloco ao
                    primeiro passo.
                </p>
            );

        case 'message':
        case 'handoff':
            return (
                <>
                    <Field
                        label={type === 'handoff' ? 'Mensagem antes de transferir (opcional)' : 'Mensagem'}
                        hint={VARIABLE_HINT}
                    >
                        <Textarea
                            value={data.text ?? ''}
                            onChange={event => set({ text: event.target.value })}
                            rows={5}
                        />
                    </Field>
                    <VariableChips variables={variables} />
                    {type === 'handoff' && (
                        <p className="text-[13px] text-muted-foreground">
                            A conversa vai para a Fila do atendimento e o bot para de responder.
                        </p>
                    )}
                </>
            );

        case 'menu': {
            const options = data.options ?? [];
            const setOptions = (next: typeof options) => set({ options: next });
            return (
                <>
                    <Field label="Pergunta" hint="As opções são numeradas automaticamente.">
                        <Textarea
                            value={data.text ?? ''}
                            onChange={event => set({ text: event.target.value })}
                            rows={3}
                        />
                    </Field>
                    <div className="grid gap-2">
                        <p className="text-sm font-medium">Opções</p>
                        {options.map((option, index) => (
                            <ListRow
                                key={option.id}
                                label={`opção ${index + 1}`}
                                onUp={index > 0 ? () => setOptions(move(options, index, index - 1)) : undefined}
                                onDown={
                                    index < options.length - 1
                                        ? () => setOptions(move(options, index, index + 1))
                                        : undefined
                                }
                                onRemove={
                                    options.length > 1
                                        ? () => setOptions(options.filter(item => item.id !== option.id))
                                        : undefined
                                }
                            >
                                <div className="flex items-center gap-2">
                                    <span className="w-5 text-right text-sm text-muted-foreground tabular-nums">
                                        {index + 1}
                                    </span>
                                    <Input
                                        value={option.label}
                                        aria-label={`Texto da opção ${index + 1}`}
                                        onChange={event =>
                                            setOptions(
                                                options.map(item =>
                                                    item.id === option.id
                                                        ? { ...item, label: event.target.value }
                                                        : item
                                                )
                                            )
                                        }
                                    />
                                </div>
                            </ListRow>
                        ))}
                        {options.length < 10 && (
                            <Button
                                type="button"
                                variant="outline"
                                size="sm"
                                className="justify-self-start"
                                onClick={() => setOptions([...options, { id: newId(), label: '' }])}
                            >
                                <Plus /> Adicionar opção
                            </Button>
                        )}
                    </div>
                    <Field label="Mensagem para resposta inválida (opcional)">
                        <Input
                            value={data.invalidText ?? ''}
                            onChange={event => set({ invalidText: event.target.value })}
                            placeholder="Opção inválida. Responda com o número de uma das opções."
                        />
                    </Field>
                    <Field label="Guardar a opção escolhida em (opcional)" hint="Nome de variável, ex.: assunto">
                        <Input
                            value={data.variable ?? ''}
                            onChange={event => set({ variable: event.target.value.replace(/\s/g, '_') })}
                        />
                    </Field>
                    <p className="text-[13px] text-muted-foreground">
                        Depois de 3 respostas inválidas segue a saída “Não entendeu”; sem ligação, transfere para
                        atendente.
                    </p>
                </>
            );
        }

        case 'question':
            return (
                <>
                    <Field label="Pergunta" hint={VARIABLE_HINT}>
                        <Textarea
                            value={data.text ?? ''}
                            onChange={event => set({ text: event.target.value })}
                            rows={3}
                        />
                    </Field>
                    <Field
                        label="Guardar a resposta em"
                        hint="Use depois como {{nome}} nas mensagens. Sem espaços nem acentos."
                    >
                        <Input
                            value={data.variable ?? ''}
                            onChange={event => set({ variable: event.target.value.replace(/\s/g, '_') })}
                            placeholder="nome_cliente"
                        />
                    </Field>
                    <Field label="Tipo de resposta">
                        <Select
                            value={data.validation ?? 'any'}
                            onChange={event => set({ validation: event.target.value as FlowNodeData['validation'] })}
                        >
                            <option value="any">Qualquer texto</option>
                            <option value="number">Número</option>
                            <option value="email">E-mail</option>
                            <option value="phone">Telefone</option>
                        </Select>
                    </Field>
                    {data.validation && data.validation !== 'any' && (
                        <Field label="Mensagem quando a resposta não servir">
                            <Input
                                value={data.invalidText ?? ''}
                                onChange={event => set({ invalidText: event.target.value })}
                                placeholder="Não entendi. Pode responder de novo?"
                            />
                        </Field>
                    )}
                </>
            );

        case 'condition': {
            const rules = data.rules ?? [];
            const setRule = (id: string, patch: Partial<Rule>) =>
                set({ rules: rules.map(rule => (rule.id === id ? { ...rule, ...patch } : rule)) });
            return (
                <>
                    <p className="text-[13px] text-muted-foreground">
                        A primeira regra verdadeira escolhe o caminho; se nenhuma valer, segue “Senão”. Comparação sem
                        diferenciar maiúsculas e acentos.
                    </p>
                    <datalist id="flow-variables">
                        <option value="message">Última mensagem</option>
                        {variables.map(name => (
                            <option key={name} value={name} />
                        ))}
                    </datalist>
                    {rules.map((rule, index) => (
                        <div key={rule.id} className="grid gap-2 rounded-lg border p-3">
                            <div className="flex items-center justify-between">
                                <p className="text-sm font-medium">Se {index + 1}</p>
                                {rules.length > 1 && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="size-7"
                                        onClick={() => set({ rules: rules.filter(item => item.id !== rule.id) })}
                                        aria-label={`Remover regra ${index + 1}`}
                                    >
                                        <X />
                                    </Button>
                                )}
                            </div>
                            <Input
                                list="flow-variables"
                                value={rule.variable}
                                onChange={event => setRule(rule.id, { variable: event.target.value })}
                                aria-label="Variável"
                                placeholder="message"
                            />
                            <Select
                                value={rule.operator}
                                onChange={event =>
                                    setRule(rule.id, { operator: event.target.value as Rule['operator'] })
                                }
                                aria-label="Comparação"
                            >
                                {OPERATORS.map(operator => (
                                    <option key={operator.value} value={operator.value}>
                                        {operator.label}
                                    </option>
                                ))}
                            </Select>
                            {rule.operator !== 'exists' && (
                                <Input
                                    value={rule.value}
                                    onChange={event => setRule(rule.id, { value: event.target.value })}
                                    aria-label="Valor"
                                    placeholder="valor"
                                />
                            )}
                        </div>
                    ))}
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="justify-self-start"
                        onClick={() =>
                            set({
                                rules: [...rules, { id: newId(), variable: 'message', operator: 'contains', value: '' }]
                            })
                        }
                    >
                        <Plus /> Adicionar regra
                    </Button>
                    <p className="text-[11px] text-muted-foreground">
                        “message” é o texto que o contato acabou de mandar.
                    </p>
                </>
            );
        }

        case 'businessHours': {
            const schedule = data.schedule ?? [];
            const setSlot = (index: number, patch: Partial<Slot>) =>
                set({ schedule: schedule.map((slot, i) => (i === index ? { ...slot, ...patch } : slot)) });
            return (
                <>
                    <Field label="Fuso horário">
                        <Select
                            value={data.timezone ?? 'America/Sao_Paulo'}
                            onChange={event => set({ timezone: event.target.value })}
                        >
                            {TIMEZONES.map(zone => (
                                <option key={zone} value={zone}>
                                    {zone.replace('America/', '').replace('_', ' ')}
                                </option>
                            ))}
                        </Select>
                    </Field>
                    {schedule.map((slot, index) => (
                        <div key={index} className="grid gap-2 rounded-lg border p-3">
                            <div className="flex flex-wrap gap-1" role="group" aria-label="Dias">
                                {WEEKDAYS.map((label, day) => {
                                    const active = slot.days.includes(day);
                                    return (
                                        <button
                                            key={day}
                                            type="button"
                                            aria-pressed={active}
                                            onClick={() =>
                                                setSlot(index, {
                                                    days: active
                                                        ? slot.days.filter(item => item !== day)
                                                        : [...slot.days, day].sort()
                                                })
                                            }
                                            className={cn(
                                                'rounded-md border px-2 py-1 text-xs font-medium',
                                                active
                                                    ? 'border-primary bg-primary-soft text-primary'
                                                    : 'text-muted-foreground hover:bg-muted'
                                            )}
                                        >
                                            {label}
                                        </button>
                                    );
                                })}
                            </div>
                            <div className="flex items-center gap-2">
                                <Input
                                    type="time"
                                    value={slot.start}
                                    onChange={event => setSlot(index, { start: event.target.value })}
                                    aria-label="Abre às"
                                />
                                <span className="text-sm text-muted-foreground">até</span>
                                <Input
                                    type="time"
                                    value={slot.end}
                                    onChange={event => setSlot(index, { end: event.target.value })}
                                    aria-label="Fecha às"
                                />
                                {schedule.length > 1 && (
                                    <Button
                                        type="button"
                                        variant="ghost"
                                        size="icon"
                                        className="size-9 shrink-0"
                                        onClick={() => set({ schedule: schedule.filter((_, i) => i !== index) })}
                                        aria-label="Remover horário"
                                    >
                                        <X />
                                    </Button>
                                )}
                            </div>
                        </div>
                    ))}
                    <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        className="justify-self-start"
                        onClick={() => set({ schedule: [...schedule, { days: [6], start: '08:00', end: '12:00' }] })}
                    >
                        <Plus /> Adicionar horário
                    </Button>
                </>
            );
        }

        case 'delay':
            return (
                <Field label="Segundos" hint="Até 30. Útil para a conversa parecer mais natural.">
                    <Input
                        type="number"
                        min={1}
                        max={30}
                        value={data.seconds ?? 2}
                        onChange={event => set({ seconds: Math.min(30, Math.max(1, Number(event.target.value) || 1)) })}
                    />
                </Field>
            );

        case 'http':
            return (
                <>
                    <div className="grid grid-cols-[96px_1fr] gap-2">
                        <Field label="Método">
                            <Select
                                value={data.method ?? 'GET'}
                                onChange={event => set({ method: event.target.value as FlowNodeData['method'] })}
                            >
                                <option>GET</option>
                                <option>POST</option>
                                <option>PUT</option>
                            </Select>
                        </Field>
                        <Field label="URL">
                            <Input
                                value={data.url ?? ''}
                                onChange={event => set({ url: event.target.value })}
                                placeholder="https://api.exemplo.com/pedidos/{{pedido}}"
                            />
                        </Field>
                    </div>
                    {data.method && data.method !== 'GET' && (
                        <Field label="Corpo (JSON)" hint={VARIABLE_HINT}>
                            <Textarea
                                className="font-mono text-xs"
                                value={data.body ?? ''}
                                onChange={event => set({ body: event.target.value })}
                                rows={5}
                                placeholder='{"telefone": "{{contact.number}}"}'
                            />
                        </Field>
                    )}
                    <Field label="Guardar a resposta em" hint="Campos do JSON viram {{resposta.campo}}.">
                        <Input
                            value={data.saveAs ?? ''}
                            onChange={event => set({ saveAs: event.target.value.replace(/\s/g, '_') })}
                        />
                    </Field>
                    <p className="text-[13px] text-muted-foreground">
                        Tempo limite de 10 s. Status 4xx/5xx ou falha de rede seguem a saída “Erro”.
                    </p>
                </>
            );

        case 'tag':
            return (
                <Field label="Etiqueta" hint="Aparece no contato, no atendimento.">
                    <Input
                        value={data.tag ?? ''}
                        onChange={event => set({ tag: event.target.value })}
                        placeholder="interessado"
                    />
                </Field>
            );

        case 'end':
            return (
                <>
                    <Field label="Mensagem final (opcional)" hint={VARIABLE_HINT}>
                        <Textarea
                            value={data.text ?? ''}
                            onChange={event => set({ text: event.target.value })}
                            rows={3}
                        />
                    </Field>
                    <label className="flex items-start justify-between gap-4 rounded-lg border p-3">
                        <span>
                            <span className="block text-sm font-medium">Encerrar a conversa</span>
                            <span className="block text-[13px] text-muted-foreground">
                                Desligado: a próxima mensagem do contato recomeça o fluxo na mesma conversa.
                            </span>
                        </span>
                        <Switch
                            checked={Boolean(data.close)}
                            onCheckedChange={close => set({ close })}
                            aria-label="Encerrar a conversa"
                        />
                    </label>
                </>
            );
    }
}

export function Inspector({ node, variables, issues, onChange, onDelete, onDuplicate, onClose }: Props) {
    const meta = NODE_META[node.type as FlowNodeType];
    const Icon = meta.icon;
    const set = (patch: Partial<FlowNodeData>) => onChange({ ...node.data, ...patch });

    return (
        <aside className="flex h-full flex-col bg-card" aria-label={`Configurar ${meta.label}`}>
            <div className="flex items-center gap-2 border-b px-4 py-3">
                <Icon className={cn('size-4', meta.tone)} aria-hidden />
                <h2 className="flex-1 text-sm font-semibold">{meta.label}</h2>
                <Button variant="ghost" size="icon" className="size-8" onClick={onClose} aria-label="Fechar">
                    <X />
                </Button>
            </div>
            <div className="grid flex-1 grid-cols-[minmax(0,1fr)] content-start gap-4 overflow-y-auto p-4">
                <p className="text-[13px] text-muted-foreground">{meta.description}</p>
                {issues && (
                    <ul
                        className="grid gap-1 rounded-lg bg-destructive-soft px-3 py-2 text-[13px] text-destructive"
                        role="alert"
                    >
                        {issues.map(issue => (
                            <li key={issue}>{issue}</li>
                        ))}
                    </ul>
                )}
                <Body type={node.type as FlowNodeType} data={node.data} set={set} variables={variables} />
            </div>
            {node.type !== 'start' && (
                <div className="flex gap-2 border-t p-3">
                    <Button variant="outline" size="sm" onClick={onDuplicate}>
                        <Copy /> Duplicar
                    </Button>
                    <Button variant="outline" size="sm" className="ml-auto text-destructive" onClick={onDelete}>
                        <Trash2 /> Excluir
                    </Button>
                </div>
            )}
        </aside>
    );
}
