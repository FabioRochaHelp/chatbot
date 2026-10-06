import type { ComponentProps } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
    'inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium whitespace-nowrap [&_svg]:size-3.5',
    {
        variants: {
            tone: {
                neutral: 'bg-muted text-muted-foreground',
                success: 'bg-primary-soft text-primary',
                warning: 'bg-warning-soft text-warning',
                info: 'bg-info-soft text-info',
                danger: 'bg-destructive-soft text-destructive'
            }
        },
        defaultVariants: { tone: 'neutral' }
    }
);

export function Badge({ className, tone, ...props }: ComponentProps<'span'> & VariantProps<typeof badgeVariants>) {
    return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}
