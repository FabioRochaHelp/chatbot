import { KeyRound } from 'lucide-react';
import { useAiStatus } from '@/lib/ai-queries';

/** Aviso quando o servidor não tem ANTHROPIC_API_KEY. */
export function AiUnavailable() {
    const { data } = useAiStatus();
    if (!data || data.available) return null;
    return (
        <div className="mb-5 flex gap-3 rounded-xl border border-warning/30 bg-warning-soft p-4 text-sm" role="alert">
            <KeyRound className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            <div>
                <p className="font-medium text-warning">IA ainda não configurada no servidor</p>
                <p className="mt-1 text-muted-foreground">
                    Crie uma chave em <span className="font-medium text-foreground">platform.claude.com</span>, coloque{' '}
                    <code className="rounded bg-card px-1">ANTHROPIC_API_KEY=...</code> no arquivo{' '}
                    <code className="rounded bg-card px-1">.env</code> e reinicie o ConectZap. Enquanto isso, conversas
                    destinadas à IA vão direto para a fila de atendimento.
                </p>
            </div>
        </div>
    );
}
