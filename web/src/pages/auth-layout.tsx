import type { ReactNode } from 'react';
import { Headset, MessagesSquare, Sparkles, Webhook, Workflow } from 'lucide-react';
import { Logo, LogoMark } from '@/components/logo';

const HIGHLIGHTS = [
    {
        icon: MessagesSquare,
        title: 'Atendimento em equipe',
        text: 'Fila, conversas por atendente, transferências e notas internas.'
    },
    { icon: Workflow, title: 'Bot de fluxos', text: 'Menus, perguntas e horário de atendimento, sem programar.' },
    {
        icon: Sparkles,
        title: 'IA que conhece o seu negócio',
        text: 'Responde com a sua base de conhecimento e chama a equipe quando precisa.'
    },
    { icon: Webhook, title: 'Integrações', text: 'API documentada, webhooks assinados e métricas.' }
];

/** Prévia de conversa: o bot atende e passa para uma pessoa (ilustra o fluxo do produto). */
function ChatPreview() {
    return (
        <div
            className="w-full max-w-sm rounded-2xl bg-white/10 p-4 shadow-2xl ring-1 ring-white/15 backdrop-blur-sm"
            aria-hidden
        >
            <div className="mb-3 flex items-center gap-2 border-b border-white/10 pb-3">
                <span className="flex size-8 items-center justify-center rounded-full bg-white/20 text-xs font-semibold">
                    MO
                </span>
                <div className="text-xs leading-tight">
                    <p className="font-semibold">Maria Oliveira</p>
                    <p className="text-emerald-100/70">online</p>
                </div>
            </div>
            <div className="grid gap-2 text-[13px] leading-snug">
                <p className="max-w-[80%] justify-self-end rounded-2xl rounded-br-md bg-emerald-300/90 px-3 py-2 text-emerald-950">
                    Oi! Meu pedido 4821 ainda não chegou 😕
                </p>
                <p className="max-w-[85%] rounded-2xl rounded-bl-md bg-white px-3 py-2 text-slate-800">
                    Olá, Maria! Vou te passar para um atendente verificar o pedido 4821. 🙂
                    <span className="mt-1 flex items-center gap-1 text-[11px] text-slate-500">
                        <Sparkles className="size-3" /> IA
                    </span>
                </p>
                <p className="flex items-center gap-1.5 justify-self-center rounded-full bg-white/15 px-3 py-1 text-[11px] text-emerald-50">
                    <Headset className="size-3" /> Transferido para Ana · Atendimento
                </p>
                <p className="max-w-[85%] rounded-2xl rounded-bl-md bg-white px-3 py-2 text-slate-800">
                    Oi, Maria! Sou a Ana. Seu pedido sai para entrega hoje à tarde.
                    <span className="mt-1 block text-[11px] text-slate-500">Ana</span>
                </p>
            </div>
        </div>
    );
}

/** Lado da marca: só em telas grandes. Cores fixas da marca (não mudam com o tema). */
function BrandPanel() {
    return (
        <section
            className="relative hidden overflow-hidden bg-gradient-to-br from-[#064e3b] via-[#047857] to-[#065f46] text-white lg:flex lg:flex-col lg:justify-between lg:gap-8 lg:px-12 lg:py-10 xl:px-16"
            aria-label="Sobre o ConectZap"
        >
            {/* textura de pontos discreta */}
            <div
                className="pointer-events-none absolute inset-0 opacity-[0.12] [background-image:radial-gradient(white_1px,transparent_1px)] [background-size:22px_22px]"
                aria-hidden
            />
            <div
                className="pointer-events-none absolute -top-32 -right-32 size-96 rounded-full bg-emerald-300/20 blur-3xl"
                aria-hidden
            />

            <div className="relative flex items-center gap-3">
                <LogoMark inverse className="size-11" />
                <span className="text-2xl font-semibold tracking-tight">
                    Conect<span className="text-emerald-300">Zap</span>
                </span>
            </div>

            <div className="relative grid max-w-3xl gap-8">
                <div className="max-w-xl">
                    <h2 className="text-4xl leading-tight font-semibold tracking-tight xl:text-[2.75rem]">
                        Atendimento no WhatsApp, do jeito da sua equipe.
                    </h2>
                    <p className="mt-4 text-lg text-emerald-50/80">
                        Conecte seus números e responda com bot, IA e atendentes no mesmo lugar, sem perder nenhuma
                        conversa.
                    </p>
                </div>
                {/* telas xl com 800px+ de altura: destaques numa coluna e a prévia ao lado; telas baixas: sem a prévia */}
                <div className="grid items-center gap-8 xl:[@media(min-height:800px)]:grid-cols-[minmax(0,1fr)_minmax(0,320px)]">
                    <ul className="grid gap-5 sm:grid-cols-2 xl:[@media(min-height:800px)]:grid-cols-1">
                        {HIGHLIGHTS.map(({ icon: Icon, title, text }) => (
                            <li key={title} className="flex gap-3">
                                <span className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-white/10 ring-1 ring-white/15">
                                    <Icon className="size-4.5 text-emerald-200" aria-hidden />
                                </span>
                                <span>
                                    <span className="block text-sm font-semibold">{title}</span>
                                    <span className="block text-[13px] leading-snug text-emerald-50/70">{text}</span>
                                </span>
                            </li>
                        ))}
                    </ul>
                    <div className="hidden xl:[@media(min-height:800px)]:block">
                        <ChatPreview />
                    </div>
                </div>
            </div>

            <p className="relative text-xs text-emerald-100/60">ConectZap · plataforma open source de atendimento</p>
        </section>
    );
}

export function AuthLayout({
    title,
    description,
    children
}: {
    title: string;
    description: ReactNode;
    children: ReactNode;
}) {
    return (
        <main className="grid min-h-dvh lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
            <BrandPanel />
            <section className="flex items-center justify-center bg-background px-4 py-10 sm:px-8">
                <div className="w-full max-w-sm">
                    {/* sem o painel da marca (celular/tablet), o logo fica sobre o formulário */}
                    <Logo className="mb-8 flex justify-center text-lg lg:hidden" />
                    <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
                    <p className="mt-1.5 mb-8 text-sm text-muted-foreground">{description}</p>
                    {children}
                </div>
            </section>
        </main>
    );
}

export function FormError({ message }: { message?: string | null }) {
    if (!message) return null;
    return (
        <p
            className="rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive first-letter:uppercase"
            role="alert"
        >
            {message}
        </p>
    );
}
