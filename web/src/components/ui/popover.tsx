import type { ComponentProps } from 'react';
import { Popover as Primitive } from 'radix-ui';
import { cn } from '@/lib/utils';

export const Popover = Primitive.Root;
export const PopoverTrigger = Primitive.Trigger;
export const PopoverAnchor = Primitive.Anchor;

export function PopoverContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof Primitive.Content>) {
    return (
        <Primitive.Portal>
            <Primitive.Content
                sideOffset={sideOffset}
                className={cn('z-50 w-64 rounded-xl border bg-card p-1 shadow-lg outline-none', className)}
                {...props}
            />
        </Primitive.Portal>
    );
}
