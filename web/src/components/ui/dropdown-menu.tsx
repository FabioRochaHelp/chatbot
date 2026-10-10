import type { ComponentProps } from 'react';
import { DropdownMenu as Primitive } from 'radix-ui';
import { cn } from '@/lib/utils';

export const DropdownMenu = Primitive.Root;
export const DropdownMenuTrigger = Primitive.Trigger;
export const DropdownMenuSub = Primitive.Sub;

const item =
    'flex cursor-default items-center gap-2 rounded-lg px-2.5 py-2 text-sm outline-none select-none data-[disabled]:opacity-50 data-[highlighted]:bg-muted [&_svg]:size-4 [&_svg]:text-muted-foreground';

export function DropdownMenuContent({ className, sideOffset = 6, ...props }: ComponentProps<typeof Primitive.Content>) {
    return (
        <Primitive.Portal>
            <Primitive.Content
                sideOffset={sideOffset}
                className={cn('z-50 min-w-52 rounded-xl border bg-card p-1 shadow-lg', className)}
                {...props}
            />
        </Primitive.Portal>
    );
}

export function DropdownMenuItem({
    className,
    destructive,
    ...props
}: ComponentProps<typeof Primitive.Item> & { destructive?: boolean }) {
    return (
        <Primitive.Item
            className={cn(item, destructive && 'text-destructive [&_svg]:text-destructive', className)}
            {...props}
        />
    );
}

export function DropdownMenuSubTrigger({ className, ...props }: ComponentProps<typeof Primitive.SubTrigger>) {
    return <Primitive.SubTrigger className={cn(item, 'data-[state=open]:bg-muted', className)} {...props} />;
}

export function DropdownMenuSubContent({ className, ...props }: ComponentProps<typeof Primitive.SubContent>) {
    return (
        <Primitive.Portal>
            <Primitive.SubContent
                className={cn(
                    'z-50 max-h-72 min-w-48 overflow-y-auto rounded-xl border bg-card p-1 shadow-lg',
                    className
                )}
                {...props}
            />
        </Primitive.Portal>
    );
}

export function DropdownMenuSeparator({ className, ...props }: ComponentProps<typeof Primitive.Separator>) {
    return <Primitive.Separator className={cn('-mx-1 my-1 h-px bg-border', className)} {...props} />;
}

export function DropdownMenuLabel({ className, ...props }: ComponentProps<typeof Primitive.Label>) {
    return <Primitive.Label className={cn('px-2.5 py-1.5 text-xs text-muted-foreground', className)} {...props} />;
}
