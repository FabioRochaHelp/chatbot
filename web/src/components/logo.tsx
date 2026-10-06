export function Logo({ className }: { className?: string }) {
    return (
        <span className={className}>
            <span className="inline-flex items-center gap-2 font-semibold tracking-tight">
                <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
                    <rect width="32" height="32" rx="8" className="fill-primary" />
                    <path
                        d="M9 22.5 10.2 18A7.5 7.5 0 1 1 13.6 21.3Z"
                        fill="none"
                        className="stroke-primary-foreground"
                        strokeWidth="2.2"
                        strokeLinejoin="round"
                    />
                </svg>
                MyZap
            </span>
        </span>
    );
}
