import { useState } from 'react';
import { Download, FileText, MapPin, StickyNote, UserRound } from 'lucide-react';
import type { Message } from '@/lib/types';
import { cn, formatWaId } from '@/lib/utils';
import { RichText } from './rich-text';

const time = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });

const ORIGIN_LABEL: Record<string, string> = { bot: 'Bot', ai: 'IA', api: 'API', phone: 'Celular' };

const mediaUrl = (message: Message) => `/api/v1/messages/${message.id}/media`;

function vcardName(vcard?: string) {
    return vcard?.match(/^FN:(.*)$/m)?.[1]?.trim();
}

function Media({ message }: { message: Message }) {
    const url = mediaUrl(message);
    // mídia recém-chegada ainda está sendo baixada pelo servidor
    const [renderedAt] = useState(() => Date.now());
    const recent = renderedAt - new Date(message.timestamp).getTime() < 60000;

    switch (message.type) {
        case 'location': {
            const { lat, lng, name } = message.payload ?? {};
            return (
                <a
                    href={`https://www.google.com/maps?q=${lat},${lng}`}
                    target="_blank"
                    rel="noreferrer"
                    className="flex items-center gap-2 font-medium underline-offset-2 hover:underline"
                >
                    <MapPin className="size-4 shrink-0" aria-hidden />
                    {name || 'Localização'}
                </a>
            );
        }
        case 'vcard':
        case 'multi_vcard':
            return (
                <span className="flex items-center gap-2 font-medium">
                    <UserRound className="size-4 shrink-0" aria-hidden />
                    {vcardName(message.payload?.vcard) || message.payload?.name || 'Contato'}
                </span>
            );
    }

    if (!message.mediaPath) {
        return (
            <span className="text-[13px] text-muted-foreground italic">
                {recent ? 'Baixando mídia…' : 'Mídia indisponível'}
            </span>
        );
    }

    switch (message.type) {
        case 'image':
        case 'sticker':
            return (
                <a href={url} target="_blank" rel="noreferrer" className="block">
                    <img
                        src={url}
                        alt={message.caption || 'Imagem'}
                        loading="lazy"
                        className={cn(
                            'rounded-lg',
                            message.type === 'sticker'
                                ? 'size-32 object-contain'
                                : 'max-h-80 w-full max-w-72 object-cover'
                        )}
                    />
                </a>
            );
        case 'video':
            return <video src={url} controls preload="metadata" className="max-h-80 w-full max-w-72 rounded-lg" />;
        case 'audio':
        case 'ptt':
            return <audio src={url} controls preload="metadata" className="h-10 w-64 max-w-full" />;
        default:
            return (
                <a
                    href={url}
                    download={message.fileName || undefined}
                    className="flex items-center gap-3 rounded-lg bg-black/5 px-3 py-2 dark:bg-white/5"
                >
                    <FileText className="size-5 shrink-0 text-muted-foreground" aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-sm font-medium">
                        {message.fileName || 'Documento'}
                    </span>
                    <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                </a>
            );
    }
}

const HAS_MEDIA = new Set([
    'image',
    'sticker',
    'video',
    'audio',
    'ptt',
    'document',
    'location',
    'vcard',
    'multi_vcard'
]);

export function MessageBubble({ message, isGroup }: { message: Message; isGroup: boolean }) {
    const at = time.format(new Date(message.timestamp));

    if (message.direction === 'note') {
        return (
            <div className="mx-auto my-1 w-full max-w-md rounded-xl border border-warning/30 bg-warning-soft px-3.5 py-2.5 text-sm">
                <p className="mb-1 flex items-center gap-1.5 text-xs font-medium text-warning">
                    <StickyNote className="size-3.5" aria-hidden />
                    Nota interna{message.sentBy && ` · ${message.sentBy.name}`}
                    <span className="ml-auto font-normal">{at}</span>
                </p>
                <p className="break-words whitespace-pre-wrap">
                    <RichText text={message.body || ''} />
                </p>
            </div>
        );
    }

    const outgoing = message.direction === 'out';
    const who = outgoing ? message.sentBy?.name || ORIGIN_LABEL[message.origin] : null;
    const text = message.type === 'chat' || message.type === 'link' ? message.body : message.caption;

    return (
        <div className={cn('flex', outgoing ? 'justify-end' : 'justify-start')}>
            <div
                className={cn(
                    'max-w-[85%] rounded-2xl px-3.5 py-2 text-sm shadow-xs sm:max-w-[70%]',
                    outgoing ? 'rounded-br-md bg-primary-soft' : 'rounded-bl-md border bg-card'
                )}
            >
                {isGroup && !outgoing && message.author && (
                    <p className="mb-0.5 text-xs font-medium text-info">{formatWaId(message.author)}</p>
                )}
                {HAS_MEDIA.has(message.type) && (
                    <div className={cn(text && 'mb-1.5')}>
                        <Media message={message} />
                    </div>
                )}
                {text && (
                    <p className="break-words whitespace-pre-wrap">
                        <RichText text={text} />
                    </p>
                )}
                <p className="mt-1 flex justify-end gap-1.5 text-[11px] text-muted-foreground">
                    {who && <span>{who} ·</span>}
                    <time dateTime={message.timestamp}>{at}</time>
                </p>
            </div>
        </div>
    );
}
