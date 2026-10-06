import type { ReactNode } from 'react';

const URL = /(https?:\/\/[^\s<]+[^\s<.,;:!?)\]'"])/g;
const STYLE = /(\*[^*\n]+\*|_[^_\n]+_|~[^~\n]+~|```[^`]+```)/g;

function styled(text: string, key: string): ReactNode[] {
    return text.split(STYLE).map((part, index) => {
        const id = key + '-' + index;
        if (/^```[\s\S]+```$/.test(part)) {
            return (
                <code key={id} className="rounded bg-black/5 px-1 font-mono text-[0.9em] dark:bg-white/10">
                    {part.slice(3, -3)}
                </code>
            );
        }
        if (/^\*[^*]+\*$/.test(part)) return <strong key={id}>{part.slice(1, -1)}</strong>;
        if (/^_[^_]+_$/.test(part)) return <em key={id}>{part.slice(1, -1)}</em>;
        if (/^~[^~]+~$/.test(part)) return <s key={id}>{part.slice(1, -1)}</s>;
        return part;
    });
}

/** Formatação do WhatsApp (*negrito*, _itálico_, ~riscado~, ```mono```) e links clicáveis. */
export function RichText({ text }: { text: string }) {
    return (
        <>
            {text.split(URL).map((part, index) =>
                index % 2 === 1 ? (
                    <a
                        key={index}
                        href={part}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="break-all text-info underline underline-offset-2"
                    >
                        {part}
                    </a>
                ) : (
                    styled(part, String(index))
                )
            )}
        </>
    );
}
