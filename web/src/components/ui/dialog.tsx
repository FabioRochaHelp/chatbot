import type { ComponentProps, ReactNode } from 'react';
import { Dialog as Primitive } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = Primitive.Root;
export const DialogTrigger = Primitive.Trigger;
export const DialogClose = Primitive.Close;

export function DialogContent({
    title,
    description,
    className,
    children,
    ...props
}: ComponentProps<typeof Primitive.Content> & { title: ReactNode; description?: ReactNode }) {
    return (
        <Primitive.Portal>
            <Primitive.Overlay className="fixed inset-0 z-50 bg-black/40 backdrop-blur-[1px]" />
            <Primitive.Content
                className={cn(
                    'fixed top-1/2 left-1/2 z-50 grid max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-xl border bg-card p-6 shadow-lg',
                    className
                )}
                {...(description ? {} : { 'aria-describedby': undefined })}
                {...props}
            >
                <div className="grid gap-1 pr-6">
                    <Primitive.Title className="text-base font-semibold">{title}</Primitive.Title>
                    {description && (
                        <Primitive.Description className="text-sm text-muted-foreground">
                            {description}
                        </Primitive.Description>
                    )}
                </div>
                {children}
                <Primitive.Close
                    className="absolute top-4 right-4 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label="Fechar"
                >
                    <X className="size-4" />
                </Primitive.Close>
            </Primitive.Content>
        </Primitive.Portal>
    );
}

/** Drawer lateral (menu no celular). */
export function SheetContent({
    className,
    children,
    ...props
}: ComponentProps<typeof Primitive.Content> & { title: string }) {
    return (
        <Primitive.Portal>
            <Primitive.Overlay className="fixed inset-0 z-50 bg-black/40" />
            <Primitive.Content
                className={cn('fixed inset-y-0 left-0 z-50 w-72 max-w-[85vw] border-r bg-card shadow-lg', className)}
                aria-describedby={undefined}
                {...props}
            >
                <Primitive.Title className="sr-only">{props.title}</Primitive.Title>
                {children}
            </Primitive.Content>
        </Primitive.Portal>
    );
}
