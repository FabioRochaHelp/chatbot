import { useState } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, Save } from 'lucide-react';
import { AiUnavailable } from '@/components/ai/ai-unavailable';
import { Playground } from '@/components/ai/playground';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api';
import { useAiStatus } from '@/lib/ai-queries';
import { EFFORTS, formatUsd, type AiAgent } from '@/lib/ai-types';
import { cn, formatNumber } from '@/lib/utils';

type Form = Pick<
    AiAgent,
    'name' | 'model' | 'effort' | 'instructions' | 'knowledge' | 'historyMessages' | 'maxRepliesPerHour'
>;
const pick = (agent: AiAgent): Form => ({
    name: agent.name,
    model: agent.model,
    effort: agent.effort,
    instructions: agent.instructions,
    knowledge: agent.knowledge,
    historyMessages: agent.historyMessages,
    maxRepliesPerHour: agent.maxRepliesPerHour
});

const KNOWLEDGE_PLACEHOLDER = `Ex.:
Loja Exemplo — roupas femininas. Rua das Flores, 120, Centro.
Horário: seg a sex 9h–18h, sáb 9h–13h.
Entrega: grátis acima de R$ 199; até 5 dias úteis para todo o Brasil.
Trocas: até 30 dias com etiqueta.
Pagamento: Pix, cartão em até 6x sem juros.`;

function Editor({ agent }: { agent: AiAgent }) {
    const queryClient = useQueryClient();
    const { data: status } = useAiStatus();
    const [form, setForm] = useState<Form>(() => pick(agent));
    const dirty = JSON.stringify(form) !== JSON.stringify(pick(agent));
    const set = <K extends keyof Form>(key: K, value: Form[K]) => setForm(current => ({ ...current, [key]: value }));

    const save = useMutation({
        mutationFn: () => api.patch<AiAgent>('/ai-agents/' + agent.id, form),
        onSuccess: saved => {
            queryClient.setQueryData(['ai-agents', agent.id], saved);
            queryClient.invalidateQueries({ queryKey: ['ai-agents'], exact: true });
            toast.success('Assistente salvo', { description: 'Vale a partir da próxima mensagem dos clientes.' });
        },
        onError: error => toast.error(error instanceof ApiError ? error.message : 'Não foi possível salvar.')
    });
    const model = status?.models.find(item => item.id === form.model);

    return (
        <>
            <Link
                to="/ai"
                className="mb-3 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
            >
                <ArrowLeft className="size-4" aria-hidden /> Assistentes de IA
            </Link>
            <PageHeader
                title={agent.name}
                description={
                    agent.sessions.length
                        ? `Em uso: ${agent.sessions.join(', ')}`
                        : 'Ainda não está ligado a nenhuma sessão (Sessões → Bot).'
                }
                actions={
                    <Button
                        onClick={() => save.mutate()}
                        loading={save.isPending}
                        disabled={!dirty || !form.name.trim()}
                    >
                        <Save /> {dirty ? 'Salvar alterações' : 'Salvo'}
                    </Button>
                }
            />
            <AiUnavailable />
            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
                <div className="grid content-start gap-4">
                    <Card>
                        <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
                            <Field label="Nome">
                                <Input
                                    value={form.name}
                                    onChange={event => set('name', event.target.value)}
                                    maxLength={100}
                                />
                            </Field>
                            <Field
                                label="Modelo"
                                hint={
                                    model
                                        ? `US$ ${model.input} por milhão de tokens de entrada, US$ ${model.output} de saída.`
                                        : undefined
                                }
                            >
                                <Select value={form.model} onChange={event => set('model', event.target.value)}>
                                    {status?.models.map(item => (
                                        <option key={item.id} value={item.id}>
                                            {item.label}
                                            {item.id === status.defaultModel ? ' (recomendado)' : ''}
                                        </option>
                                    ))}
                                </Select>
                            </Field>
                            <fieldset className="grid gap-2 sm:col-span-2">
                                <legend className="mb-1.5 text-sm font-medium">Estilo de resposta</legend>
                                <div className="grid gap-2 sm:grid-cols-3">
                                    {EFFORTS.map(effort => (
                                        <label
                                            key={effort.value}
                                            className={cn(
                                                'cursor-pointer rounded-lg border p-3 transition-colors hover:bg-muted/60',
                                                form.effort === effort.value && 'border-primary bg-primary-soft/40'
                                            )}
                                        >
                                            <input
                                                type="radio"
                                                name="effort"
                                                className="sr-only"
                                                checked={form.effort === effort.value}
                                                onChange={() => set('effort', effort.value)}
                                            />
                                            <span className="block text-sm font-medium">{effort.label}</span>
                                            <span className="block text-[13px] text-muted-foreground">
                                                {effort.description}
                                            </span>
                                        </label>
                                    ))}
                                </div>
                            </fieldset>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardTitle>Como atender</CardTitle>
                            <CardDescription>
                                Tom de voz, o que pode e o que não pode fazer, quando chamar uma pessoa.
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <Textarea
                                value={form.instructions}
                                onChange={event => set('instructions', event.target.value)}
                                rows={6}
                                aria-label="Instruções"
                            />
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardTitle>Base de conhecimento</CardTitle>
                            <CardDescription>
                                Tudo o que o assistente pode afirmar: horários, endereço, preços, prazos, políticas,
                                perguntas frequentes. O que não estiver aqui ele não inventa: transfere para um
                                atendente.
                            </CardDescription>
                        </CardHeader>
                        <CardContent className="grid gap-1.5">
                            <Textarea
                                value={form.knowledge}
                                onChange={event => set('knowledge', event.target.value)}
                                rows={14}
                                placeholder={KNOWLEDGE_PLACEHOLDER}
                                aria-label="Base de conhecimento"
                                className="font-mono text-[13px]"
                            />
                            <p className="text-right text-xs text-muted-foreground tabular-nums">
                                {formatNumber(form.knowledge.length)} caracteres
                            </p>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardContent className="grid gap-4 p-5 sm:grid-cols-2">
                            <Field
                                label="Mensagens de contexto"
                                hint="Quantas mensagens anteriores da conversa a IA lê."
                            >
                                <Input
                                    type="number"
                                    min={2}
                                    max={100}
                                    value={form.historyMessages}
                                    onChange={event => set('historyMessages', Number(event.target.value) || 20)}
                                />
                            </Field>
                            <Field
                                label="Limite de respostas por hora"
                                hint="Por conversa. Acima disso transfere para um atendente."
                            >
                                <Input
                                    type="number"
                                    min={1}
                                    max={500}
                                    value={form.maxRepliesPerHour}
                                    onChange={event => set('maxRepliesPerHour', Number(event.target.value) || 20)}
                                />
                            </Field>
                        </CardContent>
                    </Card>
                    <Card>
                        <CardHeader>
                            <CardTitle>Últimos 30 dias</CardTitle>
                            <CardDescription>
                                Custo estimado pela tabela de preços da Anthropic (sem os testes).
                            </CardDescription>
                        </CardHeader>
                        <CardContent>
                            <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                                {[
                                    ['Respostas', formatNumber(agent.usage.replies)],
                                    ['Transferidas', formatNumber(agent.usage.handoffs)],
                                    [
                                        'Tokens',
                                        formatNumber(
                                            agent.usage.inputTokens +
                                                agent.usage.cacheReadTokens +
                                                agent.usage.outputTokens
                                        )
                                    ],
                                    ['Custo', formatUsd(agent.usage.costUsd)]
                                ].map(([label, value]) => (
                                    <div key={label} className="rounded-lg bg-muted px-3 py-2">
                                        <dt className="text-xs text-muted-foreground">{label}</dt>
                                        <dd className="text-lg font-semibold tabular-nums">{value}</dd>
                                    </div>
                                ))}
                            </dl>
                        </CardContent>
                    </Card>
                </div>
                <div className="xl:sticky xl:top-8 xl:self-start">
                    <Playground
                        agent={{ id: agent.id, ...form }}
                        disabled={status && !status.available ? 'Configure a ANTHROPIC_API_KEY para testar' : undefined}
                    />
                </div>
            </div>
        </>
    );
}

export function AiAgentPage() {
    const id = Number(useParams().id);
    const {
        data: agent,
        isLoading,
        error
    } = useQuery({ queryKey: ['ai-agents', id], queryFn: () => api.get<AiAgent>('/ai-agents/' + id) });
    if (isLoading) return <Skeleton className="h-96 rounded-xl" />;
    if (error || !agent) {
        return (
            <div className="py-10 text-center">
                <p className="font-medium">Assistente não encontrado.</p>
                <Link to="/ai" className="text-sm text-primary underline-offset-4 hover:underline">
                    Voltar
                </Link>
            </div>
        );
    }
    return <Editor key={agent.id} agent={agent} />;
}
