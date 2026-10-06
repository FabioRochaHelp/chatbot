import { useId, type ReactElement, type ReactNode } from 'react';
import { Label } from 'radix-ui';
import { cloneElement } from 'react';
import { cn } from '@/lib/utils';

type FieldProps = {
    label: ReactNode;
    hint?: ReactNode;
    error?: string;
    className?: string;
    children: ReactElement<{ id?: string; 'aria-invalid'?: boolean; 'aria-describedby'?: string }>;
};

/** Rótulo + campo + dica/erro, com id e aria ligados. */
export function Field({ label, hint, error, className, children }: FieldProps) {
    const id = useId();
    const describedBy = error || hint ? id + '-help' : undefined;
    return (
        <div className={cn('grid gap-1.5', className)}>
            <Label.Root htmlFor={id} className="text-sm font-medium">
                {label}
            </Label.Root>
            {cloneElement(children, {
                id,
                'aria-invalid': Boolean(error) || undefined,
                'aria-describedby': describedBy
            })}
            {(error || hint) && (
                <p id={describedBy} className={cn('text-[13px]', error ? 'text-destructive' : 'text-muted-foreground')}>
                    {error || hint}
                </p>
            )}
        </div>
    );
}
