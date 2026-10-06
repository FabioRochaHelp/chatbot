import { useSearchParams } from 'react-router';
import { KeyRound, UserRound, Users, Zap } from 'lucide-react';
import { PageHeader } from '@/components/page-header';
import { AccountSettings } from '@/components/settings/account';
import { ApiKeysSettings } from '@/components/settings/api-keys';
import { QuickRepliesSettings } from '@/components/settings/quick-replies';
import { UsersSettings } from '@/components/settings/users';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/lib/auth';

export function SettingsPage() {
    const { principal } = useAuth();
    const admin = principal?.role === 'admin';
    const tabs = [
        ...(admin
            ? [
                  { value: 'users', label: 'Usuários', icon: Users, content: <UsersSettings /> },
                  { value: 'quick-replies', label: 'Respostas rápidas', icon: Zap, content: <QuickRepliesSettings /> },
                  { value: 'api-keys', label: 'Chaves de API', icon: KeyRound, content: <ApiKeysSettings /> }
              ]
            : []),
        { value: 'account', label: 'Minha conta', icon: UserRound, content: <AccountSettings /> }
    ];
    const [params, setParams] = useSearchParams();
    const tab = tabs.some(item => item.value === params.get('tab')) ? params.get('tab')! : tabs[0].value;

    return (
        <>
            <PageHeader title="Configurações" />
            <Tabs value={tab} onValueChange={value => setParams({ tab: value }, { replace: true })}>
                <div className="-mx-4 mb-5 overflow-x-auto px-4 sm:mx-0 sm:px-0">
                    <TabsList className="w-auto">
                        {tabs.map(({ value, label, icon: Icon }) => (
                            <TabsTrigger key={value} value={value}>
                                <Icon aria-hidden /> {label}
                            </TabsTrigger>
                        ))}
                    </TabsList>
                </div>
                {tabs.map(({ value, content }) => (
                    <TabsContent key={value} value={value}>
                        {content}
                    </TabsContent>
                ))}
            </Tabs>
        </>
    );
}
