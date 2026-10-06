import type { ComponentProps } from 'react';
import { Tabs as Primitive } from 'radix-ui';
import { cn } from '@/lib/utils';

export const Tabs = Primitive.Root;
export const TabsContent = Primitive.Content;

export function TabsList({ className, ...props }: ComponentProps<typeof Primitive.List>) {
    return (
        <Primitive.List className={cn('inline-flex w-full rounded-lg bg-muted p-1 sm:w-auto', className)} {...props} />
    );
}

export function TabsTrigger({ className, ...props }: ComponentProps<typeof Primitive.Trigger>) {
    return (
        <Primitive.Trigger
            className={cn(
                'inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 py-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:bg-card data-[state=active]:text-foreground data-[state=active]:shadow-xs sm:flex-none [&_svg]:size-4',
                className
            )}
            {...props}
        />
    );
}
