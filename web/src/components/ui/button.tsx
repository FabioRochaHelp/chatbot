import type { ComponentProps } from 'react';
import { Slot } from 'radix-ui';
import { cva, type VariantProps } from 'class-variance-authority';
import { LoaderCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

const buttonVariants = cva(
    'inline-flex shrink-0 items-center justify-center gap-2 rounded-lg text-sm font-medium whitespace-nowrap transition-colors disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
    {
        variants: {
            variant: {
                default: 'bg-primary text-primary-foreground hover:bg-primary-hover',
                outline: 'border bg-card hover:bg-muted',
                ghost: 'hover:bg-muted',
                destructive: 'bg-destructive text-white hover:bg-destructive/90',
                link: 'text-primary underline-offset-4 hover:underline'
            },
            size: {
                default: 'h-9 px-4',
                sm: 'h-8 px-3 text-[13px]',
                lg: 'h-10 px-5',
                icon: 'size-9'
            }
        },
        defaultVariants: { variant: 'default', size: 'default' }
    }
);

type ButtonProps = ComponentProps<'button'> &
    VariantProps<typeof buttonVariants> & { asChild?: boolean; loading?: boolean };

export function Button({ className, variant, size, asChild, loading, children, disabled, ...props }: ButtonProps) {
    const Component = asChild ? Slot.Root : 'button';
    return (
        <Component
            className={cn(buttonVariants({ variant, size }), className)}
            disabled={disabled || loading}
            {...props}
        >
            {asChild ? (
                children
            ) : (
                <>
                    {loading && <LoaderCircle className="animate-spin" aria-hidden />}
                    {children}
                </>
            )}
        </Component>
    );
}
