import { useCallback, useEffect, useMemo, useRef, useState, type DragEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
    addEdge,
    Background,
    Controls,
    MiniMap,
    ReactFlow,
    ReactFlowProvider,
    useEdgesState,
    useNodesState,
    useReactFlow,
    type Connection,
    type Edge,
    type EdgeChange,
    type NodeChange
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { toast } from 'sonner';
import { ArrowLeft, CircleAlert, FlaskConical, LoaderCircle, Rocket, Settings2, TriangleAlert } from 'lucide-react';
import { EditorContext, type EditorNode } from '@/components/flows/editor-context';
import { FlowNode } from '@/components/flows/flow-node';
import { Inspector } from '@/components/flows/inspector';
import { DRAG_TYPE, Palette } from '@/components/flows/palette';
import { SettingsDialog } from '@/components/flows/settings-dialog';
import { Simulator } from '@/components/flows/simulator';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { api, ApiError } from '@/lib/api';
import {
    NODE_META,
    newId,
    type Flow,
    type FlowDefinition,
    type FlowNodeData,
    type FlowNodeType,
    type FlowSettings,
    type Issue
} from '@/lib/flow-types';
import { useIsDark } from '@/lib/use-is-dark';
import { cn } from '@/lib/utils';

const nodeTypes = Object.fromEntries(Object.keys(NODE_META).map(type => [type, FlowNode]));

const toNodes = (definition: FlowDefinition): EditorNode[] =>
    definition.nodes.map(node => ({ ...node, deletable: node.type !== 'start' }));

function toDefinition(nodes: EditorNode[], edges: Edge[], settings: FlowSettings): FlowDefinition {
    return {
        nodes: nodes.map(({ id, type, position, data }) => ({
            id,
            type: type as FlowNodeType,
            position: { x: Math.round(position.x), y: Math.round(position.y) },
            data
        })),
        edges: edges.map(({ id, source, target, sourceHandle }) => ({
            id,
            source,
            target,
            sourceHandle: sourceHandle ?? null
        })),
        settings
    };
}

/** Saídas que existem no bloco (ligações de saídas removidas são descartadas). */
function validHandles(node: EditorNode) {
    return new Set(NODE_META[node.type as FlowNodeType].outputs(node.data).map(output => output.id ?? null));
}

type SaveState = 'saved' | 'saving' | 'error';
type Issues = { errors: Issue[]; warnings: Issue[] };
const NO_ISSUES: Issues = { errors: [], warnings: [] };

function Editor({ flow }: { flow: Flow }) {
    const queryClient = useQueryClient();
    const isDark = useIsDark();
    const { screenToFlowPosition, setCenter } = useReactFlow();
    const canvas = useRef<HTMLDivElement>(null);

    const [nodes, setNodes, applyNodeChanges] = useNodesState<EditorNode>(toNodes(flow.definition));
    const [edges, setEdges, applyEdgeChanges] = useEdgesState<Edge>(flow.definition.edges as Edge[]);
    const [settings, setSettings] = useState<FlowSettings>(flow.definition.settings ?? {});
    const [name, setName] = useState(flow.name);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [panel, setPanel] = useState<'inspector' | 'simulator' | null>(null);
    const [settingsOpen, setSettingsOpen] = useState(false);
    const [revision, setRevision] = useState(0);
    const [saveState, setSaveState] = useState<SaveState>('saved');
    // validação ao abrir; depois, o resultado de cada salvamento/publicação fica em validated
    const initialIssues = useQuery({
        queryKey: ['flows', flow.id, 'validate'],
        queryFn: () => api.post<Issues>('/flows/validate', { definition: flow.definition }),
        staleTime: Infinity
    });
    const [validated, setIssues] = useState<Issues | null>(null);
    const issues = validated ?? initialIssues.data ?? NO_ISSUES;
    const [trace, setTrace] = useState<{ ids: Set<string>; waiting: string | null }>({ ids: new Set(), waiting: null });

    const definition = useMemo(() => toDefinition(nodes, edges, settings), [nodes, edges, settings]);
    const latest = useRef({ definition, name });
    useEffect(() => {
        latest.current = { definition, name };
    }, [definition, name]);
    const changed = useCallback(() => {
        setRevision(value => value + 1);
        setSaveState('saving');
    }, []);

    const validate = useCallback(async (value: FlowDefinition) => {
        try {
            setIssues(await api.post<Issues>('/flows/validate', { definition: value }));
        } catch {
            // validação é só ajuda visual; o publicar valida de novo
        }
    }, []);

    const save = useCallback(async () => {
        setSaveState('saving');
        try {
            const saved = await api.patch<Flow>('/flows/' + flow.id, latest.current);
            queryClient.setQueryData(['flows', flow.id], saved);
            queryClient.invalidateQueries({ queryKey: ['flows'], exact: true });
            setSaveState('saved');
            validate(latest.current.definition);
            return true;
        } catch {
            setSaveState('error');
            return false;
        }
    }, [flow.id, queryClient, validate]);

    // salvamento automático: 800 ms depois da última alteração
    useEffect(() => {
        if (revision === 0) return;
        const timer = setTimeout(save, 800);
        return () => clearTimeout(timer);
    }, [revision, save]);

    // aviso ao fechar a aba com alteração não salva
    useEffect(() => {
        if (saveState === 'saved') return;
        const handler = (event: BeforeUnloadEvent) => event.preventDefault();
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [saveState]);

    const onNodesChange = useCallback(
        (changes: NodeChange<EditorNode>[]) => {
            applyNodeChanges(changes);
            const meaningful = changes.some(
                change =>
                    change.type === 'remove' ||
                    change.type === 'add' ||
                    (change.type === 'position' && change.dragging === false)
            );
            if (changes.some(change => change.type === 'remove')) {
                const removed = new Set(changes.filter(change => change.type === 'remove').map(change => change.id));
                setEdges(current => current.filter(edge => !removed.has(edge.source) && !removed.has(edge.target)));
                setSelectedId(current => (current && removed.has(current) ? null : current));
            }
            if (meaningful) changed();
        },
        [applyNodeChanges, setEdges, changed]
    );

    const onEdgesChange = useCallback(
        (changes: EdgeChange<Edge>[]) => {
            applyEdgeChanges(changes);
            if (changes.some(change => change.type === 'remove')) changed();
        },
        [applyEdgeChanges, changed]
    );

    // cada saída tem no máximo uma ligação: ligar de novo substitui
    const onConnect = useCallback(
        (connection: Connection) => {
            setEdges(current =>
                addEdge(
                    { ...connection, id: newId() },
                    current.filter(
                        edge =>
                            !(
                                edge.source === connection.source &&
                                (edge.sourceHandle ?? null) === (connection.sourceHandle ?? null)
                            )
                    )
                )
            );
            changed();
        },
        [setEdges, changed]
    );

    const addNode = useCallback(
        (type: FlowNodeType, position?: { x: number; y: number }) => {
            let at = position;
            if (!at) {
                const rect = canvas.current?.getBoundingClientRect();
                const center = rect
                    ? { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
                    : { x: 400, y: 300 };
                at = screenToFlowPosition(center);
                at = { x: at.x - 120 + Math.random() * 40, y: at.y - 40 + Math.random() * 40 };
            }
            const node: EditorNode = {
                id: newId(),
                type,
                position: at,
                data: NODE_META[type].create(),
                selected: true
            };
            setNodes(current => [...current.map(item => ({ ...item, selected: false })), node]);
            setSelectedId(node.id);
            setPanel('inspector');
            changed();
        },
        [screenToFlowPosition, setNodes, changed]
    );

    const updateData = useCallback(
        (id: string, data: FlowNodeData) => {
            setNodes(current => current.map(node => (node.id === id ? { ...node, data } : node)));
            const node = nodes.find(item => item.id === id);
            if (node) {
                const handles = validHandles({ ...node, data });
                setEdges(current =>
                    current.filter(edge => edge.source !== id || handles.has(edge.sourceHandle ?? null))
                );
            }
            changed();
        },
        [nodes, setNodes, setEdges, changed]
    );

    const removeNode = (id: string) => {
        setNodes(current => current.filter(node => node.id !== id));
        setEdges(current => current.filter(edge => edge.source !== id && edge.target !== id));
        setSelectedId(null);
        setPanel(null);
        changed();
    };

    const duplicateNode = (id: string) => {
        const node = nodes.find(item => item.id === id);
        if (!node) return;
        const copy: EditorNode = {
            ...node,
            id: newId(),
            position: { x: node.position.x + 40, y: node.position.y + 60 },
            data: structuredClone(node.data),
            selected: true
        };
        setNodes(current => [...current.map(item => ({ ...item, selected: false })), copy]);
        setSelectedId(copy.id);
        changed();
    };

    const focusNode = (id?: string) => {
        const node = nodes.find(item => item.id === id);
        if (!node) return;
        setCenter(node.position.x + 120, node.position.y + 60, { zoom: 1, duration: 400 });
        setNodes(current => current.map(item => ({ ...item, selected: item.id === id })));
        setSelectedId(node.id);
        setPanel('inspector');
    };

    const onDrop = (event: DragEvent) => {
        event.preventDefault();
        const type = event.dataTransfer.getData(DRAG_TYPE) as FlowNodeType;
        if (!type || !NODE_META[type]) return;
        const position = screenToFlowPosition({ x: event.clientX, y: event.clientY });
        addNode(type, { x: position.x - 120, y: position.y - 30 });
    };

    const publish = useMutation({
        mutationFn: async () => {
            if (saveState !== 'saved' && !(await save()))
                throw new ApiError(0, 'SAVE_FAILED', 'Não foi possível salvar antes de publicar.');
            return api.post<Flow & { warnings: Issue[] }>('/flows/' + flow.id + '/publish');
        },
        onSuccess: published => {
            queryClient.setQueryData(['flows', flow.id], published);
            queryClient.invalidateQueries({ queryKey: ['flows'], exact: true });
            setIssues({ errors: [], warnings: published.warnings ?? [] });
            toast.dismiss(); // tira o erro de uma tentativa anterior
            toast.success(`Fluxo publicado (versão ${published.version})`, {
                description: published.sessions.length
                    ? `Já está valendo em: ${published.sessions.join(', ')}.`
                    : 'Ligue o fluxo numa sessão em Sessões → Bot.'
            });
        },
        onError: error => {
            if (error instanceof ApiError && error.code === 'FLOW_INVALID') {
                setIssues(error.details as Issues);
                toast.error('Corrija os problemas antes de publicar.');
            } else toast.error(error instanceof ApiError ? error.message : 'Não foi possível publicar.');
        }
    });

    const issuesByNode = useMemo(() => {
        const map = new Map<string, string[]>();
        for (const issue of issues.errors) {
            if (issue.nodeId) map.set(issue.nodeId, [...(map.get(issue.nodeId) ?? []), issue.message]);
        }
        return map;
    }, [issues.errors]);

    const variables = useMemo(
        () => [
            ...new Set(
                nodes
                    .flatMap(node => [node.data.variable, node.type === 'http' ? node.data.saveAs : undefined])
                    .filter((value): value is string => Boolean(value))
            )
        ],
        [nodes]
    );

    const context = useMemo(
        () => ({ issues: issuesByNode, trace: trace.ids, waiting: trace.waiting }),
        [issuesByNode, trace]
    );
    const selected = nodes.find(node => node.id === selectedId) ?? null;
    const current = queryClient.getQueryData<Flow>(['flows', flow.id]) ?? flow;
    const totalIssues = issues.errors.length + issues.warnings.length;

    return (
        <EditorContext.Provider value={context}>
            <div className="flex h-[calc(100dvh-3.5rem)] flex-col lg:h-dvh">
                <header className="flex flex-wrap items-center gap-2 border-b bg-card px-3 py-2 sm:px-4">
                    <Button variant="ghost" size="icon" asChild>
                        <Link to="/flows" aria-label="Voltar para fluxos">
                            <ArrowLeft />
                        </Link>
                    </Button>
                    <input
                        value={name}
                        onChange={event => {
                            setName(event.target.value);
                            changed();
                        }}
                        aria-label="Nome do fluxo"
                        maxLength={100}
                        className="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-2 py-1 text-base font-semibold hover:border-border focus:border-primary focus:outline-none sm:flex-none sm:w-64"
                    />
                    <Badge tone={current.version === 0 ? 'neutral' : current.draftChanged ? 'warning' : 'success'}>
                        {current.version === 0
                            ? 'Nunca publicado'
                            : current.draftChanged
                              ? `v${current.version} · alterações não publicadas`
                              : `Publicado · v${current.version}`}
                    </Badge>
                    <span className="flex items-center gap-1 text-xs text-muted-foreground" role="status">
                        {saveState === 'saving' && <LoaderCircle className="size-3 animate-spin" aria-hidden />}
                        {saveState === 'saving' ? (
                            'Salvando…'
                        ) : saveState === 'error' ? (
                            <span className="text-destructive">Erro ao salvar</span>
                        ) : (
                            'Rascunho salvo'
                        )}
                    </span>
                    <div className="ml-auto flex items-center gap-2">
                        {totalIssues > 0 && (
                            <Popover>
                                <PopoverTrigger asChild>
                                    <Button
                                        variant="outline"
                                        size="sm"
                                        className={issues.errors.length ? 'text-destructive' : 'text-warning'}
                                    >
                                        {issues.errors.length ? <CircleAlert /> : <TriangleAlert />}
                                        {totalIssues} {totalIssues === 1 ? 'aviso' : 'avisos'}
                                    </Button>
                                </PopoverTrigger>
                                <PopoverContent align="end" className="w-80 p-2">
                                    <ul className="grid gap-1">
                                        {[
                                            ...issues.errors.map(issue => ({ ...issue, error: true })),
                                            ...issues.warnings.map(issue => ({ ...issue, error: false }))
                                        ].map((issue, index) => (
                                            <li key={index}>
                                                <button
                                                    type="button"
                                                    onClick={() => focusNode(issue.nodeId)}
                                                    disabled={!issue.nodeId}
                                                    className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[13px] hover:bg-muted disabled:hover:bg-transparent"
                                                >
                                                    {issue.error ? (
                                                        <CircleAlert
                                                            className="mt-0.5 size-3.5 shrink-0 text-destructive"
                                                            aria-label="Erro"
                                                        />
                                                    ) : (
                                                        <TriangleAlert
                                                            className="mt-0.5 size-3.5 shrink-0 text-warning"
                                                            aria-label="Aviso"
                                                        />
                                                    )}
                                                    <span>
                                                        {issue.nodeId && (
                                                            <strong className="font-medium">
                                                                {NODE_META[
                                                                    nodes.find(node => node.id === issue.nodeId)
                                                                        ?.type as FlowNodeType
                                                                ]?.label ?? 'Bloco'}
                                                                :{' '}
                                                            </strong>
                                                        )}
                                                        {issue.message}
                                                    </span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                    {issues.errors.length === 0 && (
                                        <p className="px-2 pt-1 text-xs text-muted-foreground">
                                            Avisos não impedem publicar.
                                        </p>
                                    )}
                                </PopoverContent>
                            </Popover>
                        )}
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => setSettingsOpen(true)}
                            aria-label="Configurações do fluxo"
                            title="Configurações do fluxo"
                        >
                            <Settings2 />
                        </Button>
                        <Button
                            variant={panel === 'simulator' ? 'default' : 'outline'}
                            size="sm"
                            onClick={() => setPanel(panel === 'simulator' ? null : 'simulator')}
                        >
                            <FlaskConical /> Testar
                        </Button>
                        <Button size="sm" onClick={() => publish.mutate()} loading={publish.isPending}>
                            <Rocket /> Publicar
                        </Button>
                    </div>
                </header>

                <div className="relative flex min-h-0 flex-1">
                    <aside className="hidden w-52 shrink-0 border-r bg-card md:block">
                        <Palette onAdd={type => addNode(type)} />
                    </aside>
                    <div
                        ref={canvas}
                        className="min-w-0 flex-1"
                        onDragOver={event => event.preventDefault()}
                        onDrop={onDrop}
                    >
                        <ReactFlow
                            nodes={nodes}
                            edges={edges}
                            nodeTypes={nodeTypes}
                            onNodesChange={onNodesChange}
                            onEdgesChange={onEdgesChange}
                            onConnect={onConnect}
                            isValidConnection={connection => connection.source !== connection.target}
                            onNodeClick={(_, node) => {
                                setSelectedId(node.id);
                                if (panel !== 'simulator') setPanel('inspector');
                            }}
                            onPaneClick={() => {
                                setSelectedId(null);
                                if (panel === 'inspector') setPanel(null);
                            }}
                            deleteKeyCode={['Backspace', 'Delete']}
                            colorMode={isDark ? 'dark' : 'light'}
                            defaultEdgeOptions={{ animated: false }}
                            minZoom={0.2}
                            fitView
                            // não reduz demais para caber tudo: abaixo de ~0,65 o texto dos blocos fica ilegível
                            fitViewOptions={{ padding: 0.15, maxZoom: 1, minZoom: 0.65 }}
                            proOptions={{ hideAttribution: true }}
                        >
                            <Background gap={20} size={1.5} />
                            <Controls showInteractive={false} />
                            <MiniMap pannable zoomable className="!hidden lg:!block" />
                        </ReactFlow>
                    </div>
                    {panel && (
                        <div
                            className={cn(
                                'absolute inset-y-0 right-0 z-10 w-full max-w-sm border-l shadow-lg lg:static lg:w-80 lg:shadow-none'
                            )}
                        >
                            {panel === 'simulator' ? (
                                <Simulator
                                    definition={definition}
                                    onTrace={(ids, waiting) => setTrace({ ids: new Set(ids), waiting })}
                                    onClose={() => {
                                        setPanel(null);
                                        setTrace({ ids: new Set(), waiting: null });
                                    }}
                                />
                            ) : selected ? (
                                <Inspector
                                    key={selected.id}
                                    node={selected}
                                    variables={variables}
                                    issues={issuesByNode.get(selected.id)}
                                    onChange={data => updateData(selected.id, data)}
                                    onDelete={() => removeNode(selected.id)}
                                    onDuplicate={() => duplicateNode(selected.id)}
                                    onClose={() => setPanel(null)}
                                />
                            ) : null}
                        </div>
                    )}
                </div>
                <p className="border-t bg-warning-soft px-4 py-2 text-center text-[13px] text-warning md:hidden">
                    Para montar fluxos, prefira uma tela maior. Aqui dá para revisar e testar.
                </p>
            </div>
            <SettingsDialog
                settings={settings}
                open={settingsOpen}
                onOpenChange={setSettingsOpen}
                onSave={next => {
                    setSettings(next);
                    changed();
                }}
            />
        </EditorContext.Provider>
    );
}

export function FlowEditorPage() {
    const id = Number(useParams().id);
    const {
        data: flow,
        isLoading,
        error
    } = useQuery({ queryKey: ['flows', id], queryFn: () => api.get<Flow>('/flows/' + id), staleTime: Infinity });
    if (isLoading) {
        return (
            <div className="grid gap-4 p-6">
                <Skeleton className="h-10 w-72" />
                <Skeleton className="h-[60vh] rounded-xl" />
            </div>
        );
    }
    if (error || !flow) {
        return (
            <div className="p-8 text-center">
                <p className="font-medium">Fluxo não encontrado.</p>
                <Link to="/flows" className="text-sm text-primary underline-offset-4 hover:underline">
                    Voltar para fluxos
                </Link>
            </div>
        );
    }
    return (
        <ReactFlowProvider>
            <Editor key={flow.id} flow={flow} />
        </ReactFlowProvider>
    );
}
