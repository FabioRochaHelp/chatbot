import { createContext, useContext } from 'react';
import type { Node } from '@xyflow/react';
import type { FlowNodeData, FlowNodeType } from '@/lib/flow-types';

export type EditorNode = Node<FlowNodeData, FlowNodeType>;

export type EditorState = {
    /** problemas da última validação, por bloco */
    issues: Map<string, string[]>;
    /** blocos percorridos na última mensagem do simulador */
    trace: Set<string>;
    /** bloco onde o simulador está esperando resposta */
    waiting: string | null;
};

export const EditorContext = createContext<EditorState>({ issues: new Map(), trace: new Set(), waiting: null });
export const useEditor = () => useContext(EditorContext);
