import { useState } from 'react';
import { Users } from 'lucide-react';
import { initials } from '@/lib/contacts';
import { cn } from '@/lib/utils';

// tons neutros derivados do nome: distingue pessoas sem competir com as cores de status
const TONES = ['bg-muted text-foreground', 'bg-primary-soft text-primary', 'bg-info-soft text-info'];

/** Foto (se houver) ou iniciais. Se a foto falhar ao carregar, volta para as iniciais. */
export function Avatar({
    name,
    group,
    src,
    className
}: {
    name: string;
    group?: boolean;
    src?: string | null;
    className?: string;
}) {
    const [failed, setFailed] = useState<string | null>(null);
    const tone = TONES[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % TONES.length];
    const base = cn(
        'flex size-10 shrink-0 items-center justify-center overflow-hidden rounded-full text-sm font-semibold',
        className
    );
    if (src && failed !== src) {
        return (
            <span className={cn(base, 'bg-muted')} aria-hidden>
                <img
                    src={src}
                    alt=""
                    loading="lazy"
                    className="size-full object-cover"
                    onError={() => setFailed(src)}
                />
            </span>
        );
    }
    return (
        <span className={cn(base, tone)} aria-hidden>
            {group ? <Users className="size-4" /> : initials(name)}
        </span>
    );
}
