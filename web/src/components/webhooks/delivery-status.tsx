import { CircleCheck, CircleX, Clock } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import type { DeliveryStatus } from '@/lib/webhook-types';

const INFO = {
    success: { label: 'Entregue', tone: 'success', icon: CircleCheck },
    pending: { label: 'Aguardando', tone: 'warning', icon: Clock },
    failed: { label: 'Falhou', tone: 'danger', icon: CircleX }
} as const;

export function DeliveryStatusBadge({ status }: { status: DeliveryStatus }) {
    const { label, tone, icon: Icon } = INFO[status];
    return (
        <Badge tone={tone}>
            <Icon aria-hidden /> {label}
        </Badge>
    );
}
