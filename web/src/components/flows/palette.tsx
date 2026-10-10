import type { DragEvent } from 'react';
import { NODE_META, PALETTE, type FlowNodeType } from '@/lib/flow-types';
import { cn } from '@/lib/utils';

export const DRAG_TYPE = 'application/x-conectzap-node';

export function Palette({ onAdd }: { onAdd: (type: FlowNodeType) => void }) {
    const onDragStart = (event: DragEvent, type: FlowNodeType) => {
        event.dataTransfer.setData(DRAG_TYPE, type);
        event.dataTransfer.effectAllowed = 'move';
    };
    return (
        <nav className="grid content-start gap-1 overflow-y-auto p-3" aria-label="Blocos">
            <p className="px-1 pb-1 text-xs font-medium text-muted-foreground">Arraste ou clique para adicionar</p>
            {PALETTE.map(type => {
                const meta = NODE_META[type];
                const Icon = meta.icon;
                return (
                    <button
                        key={type}
                        type="button"
                        draggable
                        onDragStart={event => onDragStart(event, type)}
                        onClick={() => onAdd(type)}
                        title={meta.description}
                        className="flex cursor-grab items-center gap-2.5 rounded-lg border bg-card px-2.5 py-2 text-left text-sm transition-colors hover:border-primary/40 hover:bg-muted active:cursor-grabbing"
                    >
                        <Icon className={cn('size-4 shrink-0', meta.tone)} aria-hidden />
                        <span className="truncate font-medium">{meta.label}</span>
                    </button>
                );
            })}
        </nav>
    );
}
