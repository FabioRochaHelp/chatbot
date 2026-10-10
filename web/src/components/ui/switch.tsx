import type { ComponentProps } from 'react';
import { Switch as Primitive } from 'radix-ui';
import { cn } from '@/lib/utils';

export function Switch({ className, ...props }: ComponentProps<typeof Primitive.Root>) {
    return (
        <Primitive.Root
            className={cn(
                'inline-flex h-5 w-9 shrink-0 items-center rounded-full bg-input p-0.5 transition-colors disabled:opacity-50 data-[state=checked]:bg-primary',
                className
            )}
            {...props}
        >
            <Primitive.Thumb className="size-4 rounded-full bg-white shadow-sm transition-transform data-[state=checked]:translate-x-4" />
        </Primitive.Root>
    );
}
