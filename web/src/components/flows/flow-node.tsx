import { memo } from 'react';
import { Handle, Position, type NodeProps } from '@xyflow/react';
import { CircleAlert } from 'lucide-react';
import { NODE_META, nodeSummary } from '@/lib/flow-types';
import { cn } from '@/lib/utils';
import { useEditor, type EditorNode } from './editor-context';

// blocos que não fazem sentido sem conteúdo (os demais têm resumo próprio ou nenhum)
const NEEDS_CONTENT = new Set(['message', 'menu', 'question', 'http', 'tag']);

const handleClass = '!size-3 !border-2 !border-card !bg-muted-foreground hover:!bg-primary';

function FlowNodeView({ id, type, data, selected }: NodeProps<EditorNode>) {
    const { issues, trace, waiting } = useEditor();
    const meta = NODE_META[type];
    const Icon = meta.icon;
    const outputs = meta.outputs(data);
    const problems = issues.get(id);
    const summary = nodeSummary(type, data);
    const single = outputs.length === 1 && outputs[0].id === null;

    return (
        <div
            className={cn(
                'w-60 rounded-xl border bg-card text-left shadow-xs transition-shadow',
                selected && 'border-primary ring-3 ring-ring',
                problems && !selected && 'border-destructive',
                trace.has(id) && !selected && 'border-info ring-2 ring-info/30',
                waiting === id && 'ring-3 ring-warning/50'
            )}
        >
            {type !== 'start' && <Handle type="target" position={Position.Left} className={handleClass} />}
            <div className="flex items-center gap-2 px-3 pt-2.5 pb-1">
                <Icon className={cn('size-4 shrink-0', meta.tone)} aria-hidden />
                <span className="flex-1 truncate text-[13px] font-semibold">{meta.label}</span>
                {problems && (
                    <span title={problems.join('\n')}>
                        <CircleAlert className="size-4 text-destructive" aria-label={problems.join('. ')} />
                    </span>
                )}
            </div>
            {summary && (
                <p className="line-clamp-3 px-3 pb-2 text-xs break-words whitespace-pre-line text-muted-foreground">
                    {summary}
                </p>
            )}
            {!summary && NEEDS_CONTENT.has(type) && (
                <p className="px-3 pb-2 text-xs text-destructive">Configure este bloco</p>
            )}
            {single ? (
                <Handle type="source" position={Position.Right} className={handleClass} />
            ) : (
                outputs.length > 0 && (
                    <div className="border-t py-1">
                        {outputs.map(output => (
                            <div
                                key={output.id}
                                className="relative px-3 py-1 text-right text-[11px] text-muted-foreground"
                            >
                                <span className="block truncate pl-4">{output.label}</span>
                                <Handle
                                    type="source"
                                    id={output.id ?? undefined}
                                    position={Position.Right}
                                    className={handleClass}
                                />
                            </div>
                        ))}
                    </div>
                )
            )}
        </div>
    );
}

export const FlowNode = memo(FlowNodeView);
