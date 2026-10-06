import { useMemo, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Check, Copy, FileUp, Link2, MapPin, MessageSquareText, Send } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input, Select, Textarea } from '@/components/ui/input';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { api, ApiError } from '@/lib/api';
import { useSessions } from '@/lib/queries';
import type { Message } from '@/lib/types';
import { fileToDataUrl } from '@/lib/utils';

type Kind = 'text' | 'file' | 'location' | 'link';
const MAX_FILE_MB = 15; // o JSON da API aceita até 20 MB (base64 cresce ~33%)

function CopyButton({ text }: { text: string }) {
    const [copied, setCopied] = useState(false);
    return (
        <Button
            variant="ghost"
            size="sm"
            onClick={async () => {
                try {
                    await navigator.clipboard.writeText(text);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                } catch {
                    toast.error('Não foi possível copiar.');
                }
            }}
        >
            {copied ? <Check /> : <Copy />}
            {copied ? 'Copiado' : 'Copiar'}
        </Button>
    );
}

export function SendPage() {
    const [params] = useSearchParams();
    const { data: sessions } = useSessions();
    const connected = useMemo(() => (sessions ?? []).filter(session => session.state === 'CONNECTED'), [sessions]);

    const [session, setSession] = useState(params.get('session') ?? '');
    const [kind, setKind] = useState<Kind>('text');
    const [to, setTo] = useState('');
    const [text, setText] = useState('');
    const [file, setFile] = useState<File | null>(null);
    const [caption, setCaption] = useState('');
    const [location, setLocation] = useState({ lat: '', lng: '', name: '' });
    const [url, setUrl] = useState('');
    const [fileError, setFileError] = useState<string | null>(null);

    const selected = connected.some(item => item.name === session) ? session : (connected[0]?.name ?? '');

    const preview = useMemo(() => {
        const base = { to: to || '5511999999999' };
        if (kind === 'text') return { ...base, type: 'text', text: text || 'Olá!' };
        if (kind === 'file')
            return {
                ...base,
                type: 'file',
                fileName: file?.name || 'arquivo.pdf',
                base64: '<conteúdo em base64>',
                ...(caption ? { caption } : {})
            };
        if (kind === 'location')
            return {
                ...base,
                type: 'location',
                lat: Number(location.lat) || 0,
                lng: Number(location.lng) || 0,
                ...(location.name ? { name: location.name } : {})
            };
        return { ...base, type: 'link', url: url || 'https://exemplo.com', ...(caption ? { caption } : {}) };
    }, [kind, to, text, file, caption, location, url]);

    const curl = [
        `curl -X POST ${window.location.origin}/api/v1/sessions/${encodeURIComponent(selected || 'minha-sessao')}/messages \\`,
        `  -H "Authorization: Bearer $CONECTZAP_API_KEY" \\`,
        `  -H "Content-Type: application/json" \\`,
        `  -d '${JSON.stringify(preview).replace(/'/g, "'\\''")}'`
    ].join('\n');

    const send = useMutation({
        mutationFn: async () => {
            const body: Record<string, unknown> = { ...preview, to };
            if (kind === 'text') body.text = text;
            if (kind === 'file') {
                if (!file) throw new ApiError(400, 'NO_FILE', 'Escolha um arquivo.');
                body.base64 = await fileToDataUrl(file);
            }
            if (kind === 'location') {
                body.lat = location.lat === '' ? undefined : Number(location.lat);
                body.lng = location.lng === '' ? undefined : Number(location.lng);
            }
            if (kind === 'link') body.url = url;
            return api.post<Message | null>('/sessions/' + encodeURIComponent(selected) + '/messages', body);
        },
        onSuccess: () => {
            toast.success('Mensagem enviada');
            setText('');
        }
    });

    const error = send.error instanceof ApiError ? send.error : null;
    const fields = error?.fieldErrors ?? {};
    const general = error && error.code !== 'INVALID_PARAMS' ? error.message : null;

    const submit = (event: FormEvent) => {
        event.preventDefault();
        send.mutate();
    };

    return (
        <>
            <PageHeader
                title="Enviar mensagem"
                description="Teste um envio pela API v1 e veja a chamada equivalente para usar na sua integração."
            />
            <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,420px)]">
                <Card>
                    <CardContent className="p-5 sm:p-6">
                        {sessions && connected.length === 0 ? (
                            <div className="py-8 text-center">
                                <p className="font-medium">Nenhuma sessão conectada</p>
                                <p className="mt-1 text-sm text-muted-foreground">
                                    Conecte um número antes de enviar mensagens.
                                </p>
                                <Button asChild className="mt-4">
                                    <Link to="/sessions">Ir para Sessões</Link>
                                </Button>
                            </div>
                        ) : (
                            <form className="grid gap-5" onSubmit={submit} noValidate>
                                <div className="grid gap-4 sm:grid-cols-2">
                                    <Field label="Sessão">
                                        <Select value={selected} onChange={event => setSession(event.target.value)}>
                                            {connected.map(item => (
                                                <option key={item.name} value={item.name}>
                                                    {item.name}
                                                </option>
                                            ))}
                                        </Select>
                                    </Field>
                                    <Field
                                        label="Para"
                                        hint="Com DDI e DDD. Ex.: 55 11 99999-9999"
                                        error={fields.to && 'Número inválido'}
                                    >
                                        <Input
                                            type="tel"
                                            inputMode="tel"
                                            value={to}
                                            onChange={event => setTo(event.target.value)}
                                            placeholder="55 11 99999-9999"
                                        />
                                    </Field>
                                </div>

                                <Tabs value={kind} onValueChange={value => setKind(value as Kind)}>
                                    <TabsList aria-label="Tipo de mensagem">
                                        <TabsTrigger value="text">
                                            <MessageSquareText aria-hidden /> Texto
                                        </TabsTrigger>
                                        <TabsTrigger value="file">
                                            <FileUp aria-hidden /> Arquivo
                                        </TabsTrigger>
                                        <TabsTrigger value="location">
                                            <MapPin aria-hidden /> Local
                                        </TabsTrigger>
                                        <TabsTrigger value="link">
                                            <Link2 aria-hidden /> Link
                                        </TabsTrigger>
                                    </TabsList>

                                    <TabsContent value="text" className="mt-4">
                                        <Field label="Mensagem" error={fields.text && 'Escreva a mensagem'}>
                                            <Textarea
                                                value={text}
                                                onChange={event => setText(event.target.value)}
                                                placeholder="Olá! Seu pedido saiu para entrega."
                                                rows={5}
                                            />
                                        </Field>
                                    </TabsContent>

                                    <TabsContent value="file" className="mt-4 grid gap-4">
                                        <Field
                                            label="Arquivo"
                                            hint={`Imagem, PDF, planilha… até ${MAX_FILE_MB} MB.`}
                                            error={fileError || (fields.base64 && 'Escolha um arquivo')}
                                        >
                                            <Input
                                                type="file"
                                                className="py-1.5 file:mr-3 file:rounded-md file:border-0 file:bg-muted file:px-2 file:py-0.5 file:text-sm file:font-medium"
                                                onChange={event => {
                                                    const chosen = event.target.files?.[0] ?? null;
                                                    const tooBig = chosen && chosen.size > MAX_FILE_MB * 1024 * 1024;
                                                    setFileError(
                                                        tooBig ? `O arquivo passa de ${MAX_FILE_MB} MB.` : null
                                                    );
                                                    setFile(tooBig ? null : chosen);
                                                }}
                                            />
                                        </Field>
                                        <Field label="Legenda (opcional)">
                                            <Input value={caption} onChange={event => setCaption(event.target.value)} />
                                        </Field>
                                    </TabsContent>

                                    <TabsContent value="location" className="mt-4 grid gap-4 sm:grid-cols-2">
                                        <Field label="Latitude" error={fields.lat && 'Entre -90 e 90'}>
                                            <Input
                                                inputMode="decimal"
                                                value={location.lat}
                                                onChange={event =>
                                                    setLocation({ ...location, lat: event.target.value })
                                                }
                                                placeholder="-23.5505"
                                            />
                                        </Field>
                                        <Field label="Longitude" error={fields.lng && 'Entre -180 e 180'}>
                                            <Input
                                                inputMode="decimal"
                                                value={location.lng}
                                                onChange={event =>
                                                    setLocation({ ...location, lng: event.target.value })
                                                }
                                                placeholder="-46.6333"
                                            />
                                        </Field>
                                        <Field label="Nome do local (opcional)" className="sm:col-span-2">
                                            <Input
                                                value={location.name}
                                                onChange={event =>
                                                    setLocation({ ...location, name: event.target.value })
                                                }
                                            />
                                        </Field>
                                    </TabsContent>

                                    <TabsContent value="link" className="mt-4 grid gap-4">
                                        <Field label="URL" error={fields.url && 'URL inválida'}>
                                            <Input
                                                type="url"
                                                value={url}
                                                onChange={event => setUrl(event.target.value)}
                                                placeholder="https://"
                                            />
                                        </Field>
                                        <Field label="Texto (opcional)">
                                            <Input value={caption} onChange={event => setCaption(event.target.value)} />
                                        </Field>
                                    </TabsContent>
                                </Tabs>

                                {general && (
                                    <p
                                        className="rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive"
                                        role="alert"
                                    >
                                        {general}
                                    </p>
                                )}
                                <div className="flex justify-end">
                                    <Button type="submit" loading={send.isPending} disabled={!selected}>
                                        <Send /> Enviar
                                    </Button>
                                </div>
                            </form>
                        )}
                    </CardContent>
                </Card>

                <Card className="min-w-0 self-start">
                    <CardHeader className="flex-row items-start justify-between gap-2">
                        <div>
                            <CardTitle>Chamada equivalente</CardTitle>
                            <CardDescription>
                                Crie uma chave de API e use no lugar de{' '}
                                <code className="text-xs">$CONECTZAP_API_KEY</code>.
                            </CardDescription>
                        </div>
                        <CopyButton text={curl} />
                    </CardHeader>
                    <CardContent>
                        <pre className="overflow-x-auto rounded-lg bg-muted p-3 text-xs leading-relaxed">
                            <code>{curl}</code>
                        </pre>
                        <a
                            href="/api/docs"
                            target="_blank"
                            rel="noreferrer"
                            className="mt-3 inline-block text-sm text-primary underline-offset-4 hover:underline"
                        >
                            Ver todos os tipos na documentação
                        </a>
                    </CardContent>
                </Card>
            </div>
        </>
    );
}
