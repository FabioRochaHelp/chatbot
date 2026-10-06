import { Badge } from '@/components/ui/badge';
import { stateInfo } from '@/lib/sessions';
import { cn } from '@/lib/utils';

export function SessionStateBadge({ state, className }: { state: string; className?: string }) {
    const { label, tone, icon: Icon } = stateInfo(state);
    return (
        <Badge tone={tone} className={className}>
            <Icon className={cn(tone === 'info' && 'animate-spin')} aria-hidden />
            {label}
        </Badge>
    );
}
