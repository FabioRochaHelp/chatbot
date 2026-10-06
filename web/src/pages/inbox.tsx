import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import { MessagesSquare } from 'lucide-react';
import { ConversationList, type Filter } from '@/components/inbox/conversation-list';
import { ContactPanel } from '@/components/inbox/contact-panel';
import { Thread, useConversation } from '@/components/inbox/thread';
import { Dialog, SheetContent } from '@/components/ui/dialog';
import { useMediaQuery } from '@/lib/media-query';
import { cn } from '@/lib/utils';

const WIDE = '(min-width: 1280px)';

function Details({ id, open, onOpenChange }: { id: number; open: boolean; onOpenChange: (open: boolean) => void }) {
    const { data: conversation } = useConversation(id);
    // telas largas: coluna fixa ao lado da conversa; demais: gaveta por cima
    const wide = useMediaQuery(WIDE);
    if (!conversation) return null;
    const panel = (
        <ContactPanel
            key={conversation.contact.id + ':' + (conversation.contact.name ?? '')}
            conversation={conversation}
            onClose={() => onOpenChange(false)}
        />
    );
    if (wide) return open ? <div className="w-80 shrink-0 border-l">{panel}</div> : null;
    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <SheetContent title="Contato" className="right-0 left-auto border-r-0 border-l">
                {panel}
            </SheetContent>
        </Dialog>
    );
}

export function InboxPage() {
    const params = useParams();
    const id = params.id ? Number(params.id) : null;
    const [search, setSearch] = useSearchParams();
    const filter = (search.get('f') as Filter) || 'queue';
    const [details, setDetails] = useState(() => window.matchMedia(WIDE).matches);

    return (
        <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 lg:h-dvh">
            <section
                className={cn(
                    'flex w-full min-w-0 flex-col border-r bg-card lg:w-[340px] lg:shrink-0',
                    id !== null && 'hidden lg:flex'
                )}
                aria-label="Conversas"
            >
                <ConversationList filter={filter} onFilter={value => setSearch({ f: value }, { replace: true })} />
            </section>
            {id !== null ? (
                <>
                    <Thread key={id} id={id} onToggleDetails={() => setDetails(open => !open)} />
                    <Details id={id} open={details} onOpenChange={setDetails} />
                </>
            ) : (
                <div className="hidden flex-1 flex-col items-center justify-center gap-3 bg-muted/40 text-center lg:flex">
                    <MessagesSquare className="size-10 text-muted-foreground" aria-hidden />
                    <p className="font-medium">Escolha uma conversa</p>
                    <p className="max-w-xs text-sm text-muted-foreground">
                        As conversas na fila aguardam um atendente. Abra uma e clique em <strong>Assumir</strong>.
                    </p>
                </div>
            )}
        </div>
    );
}
