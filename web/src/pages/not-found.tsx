import { Link } from 'react-router';
import { Button } from '@/components/ui/button';

export function NotFoundPage() {
    return (
        <div className="flex flex-col items-center py-20 text-center">
            <p className="text-sm font-medium text-primary">404</p>
            <h1 className="mt-2 text-2xl font-semibold">Página não encontrada</h1>
            <p className="mt-2 text-sm text-muted-foreground">O endereço pode ter mudado ou não existe.</p>
            <Button asChild className="mt-6">
                <Link to="/">Voltar ao painel</Link>
            </Button>
        </div>
    );
}
