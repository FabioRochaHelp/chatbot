import { cn } from '@/lib/utils';

/**
 * Símbolo do ConectZap: dois balões de conversa (conexão) e o raio (zap). Cores seguem o tema.
 * inverse: fundo branco e balões na cor da marca, para usar sobre fundos verdes.
 */
export function LogoMark({ className, inverse }: { className?: string; inverse?: boolean }) {
    const tile = inverse ? 'fill-white' : 'fill-primary';
    const ink = inverse ? 'fill-[#047857]' : 'fill-primary-foreground';
    const bolt = inverse ? 'fill-white' : 'fill-primary';
    return (
        <svg viewBox="0 0 32 32" className={cn('size-7 shrink-0', className)} aria-hidden>
            <rect width="32" height="32" rx="8" className={tile} />
            <path
                d="M20.2 4.8c3.9 0 7 2.8 7 6.3 0 1.7-.7 3.2-1.9 4.3l.6 3.2-3.1-1.6c-.8.2-1.7.4-2.6.4-3.9 0-7-2.8-7-6.3s3.1-6.3 7-6.3Z"
                className={cn(ink, 'opacity-50')}
            />
            <path
                d="M14 9c-5 0-9 3.5-9 7.9 0 2.3 1.1 4.4 2.9 5.8L7.3 26.5l4.2-2.2c.8.2 1.6.3 2.5.3 5 0 9-3.5 9-7.8S19 9 14 9Z"
                className={cn(ink, inverse ? 'stroke-white' : 'stroke-primary')}
                strokeWidth="1.6"
            />
            <path d="M15.3 11.4 10.8 17.8h3l-1 4.9 4.6-6.6h-3l.9-4.7Z" className={bolt} />
        </svg>
    );
}

/** compact: só o símbolo (menu recolhido). */
export function Logo({ className, compact }: { className?: string; compact?: boolean }) {
    return (
        <span className={className}>
            <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
                <LogoMark />
                <span className={cn(compact && 'sr-only')}>
                    Conect<span className="text-primary">Zap</span>
                </span>
            </span>
        </span>
    );
}
