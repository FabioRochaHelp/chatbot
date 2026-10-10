import { Users } from 'lucide-react';
import { initials } from '@/lib/contacts';
import { cn } from '@/lib/utils';

// tons neutros derivados do nome: distingue pessoas sem competir com as cores de status
const TONES = ['bg-muted text-foreground', 'bg-primary-soft text-primary', 'bg-info-soft text-info'];

export function Avatar({ name, group, className }: { name: string; group?: boolean; className?: string }) {
    const tone = TONES[[...name].reduce((sum, char) => sum + char.charCodeAt(0), 0) % TONES.length];
    return (
        <span
            className={cn(
                'flex size-10 shrink-0 items-center justify-center rounded-full text-sm font-semibold',
                tone,
                className
            )}
            aria-hidden
        >
            {group ? <Users className="size-4" /> : initials(name)}
        </span>
    );
}
