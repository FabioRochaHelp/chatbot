import type { ComponentProps, ReactNode } from 'react';
import { Tooltip as Primitive } from 'radix-ui';
import { cn } from '@/lib/utils';

export const TooltipProvider = Primitive.Provider;

/** Dica ao passar o mouse ou focar com o teclado. disabled: renderiza só o filho. */
export function Tooltip({
    content,
    children,
    side = 'right',
    disabled,
    className,
    ...props
}: { content: ReactNode; children: ReactNode; disabled?: boolean } & Omit<
    ComponentProps<typeof Primitive.Content>,
    'content'
>) {
    if (disabled) return <>{children}</>;
    return (
        <Primitive.Root>
            <Primitive.Trigger asChild>{children}</Primitive.Trigger>
            <Primitive.Portal>
                <Primitive.Content
                    side={side}
                    sideOffset={8}
                    className={cn(
                        'z-50 rounded-md bg-foreground px-2 py-1 text-xs font-medium text-background shadow-md',
                        className
                    )}
                    {...props}
                >
                    {content}
                </Primitive.Content>
            </Primitive.Portal>
        </Primitive.Root>
    );
}
