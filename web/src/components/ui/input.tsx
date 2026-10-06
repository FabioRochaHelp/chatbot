import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

const field =
    'w-full rounded-lg border border-input bg-card px-3 text-sm placeholder:text-muted-foreground/70 transition-colors focus-visible:border-primary focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring disabled:opacity-50 aria-invalid:border-destructive';

export function Input({ className, ...props }: ComponentProps<'input'>) {
    return <input className={cn(field, 'h-9', className)} {...props} />;
}

export function Textarea({ className, ...props }: ComponentProps<'textarea'>) {
    return <textarea className={cn(field, 'min-h-24 resize-y py-2', className)} {...props} />;
}

export function Select({ className, ...props }: ComponentProps<'select'>) {
    return <select className={cn(field, 'h-9 pr-8', className)} {...props} />;
}
