import type { ReactNode } from 'react';
import { Logo } from '@/components/logo';
import { Card, CardContent } from '@/components/ui/card';

export function AuthLayout({
    title,
    description,
    children
}: {
    title: string;
    description: ReactNode;
    children: ReactNode;
}) {
    return (
        <main className="flex min-h-dvh items-center justify-center bg-muted/50 px-4 py-10">
            <div className="w-full max-w-sm">
                <Logo className="mb-6 flex justify-center text-lg" />
                <Card>
                    <CardContent className="p-6 sm:p-7">
                        <h1 className="text-lg font-semibold">{title}</h1>
                        <p className="mt-1 mb-6 text-sm text-muted-foreground">{description}</p>
                        {children}
                    </CardContent>
                </Card>
            </div>
        </main>
    );
}

export function FormError({ message }: { message?: string | null }) {
    if (!message) return null;
    return (
        <p
            className="rounded-lg bg-destructive-soft px-3 py-2 text-sm text-destructive first-letter:uppercase"
            role="alert"
        >
            {message}
        </p>
    );
}
