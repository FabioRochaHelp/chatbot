import { createContext, useContext } from 'react';

export type RealtimeValue = {
    connected: boolean;
    /** último QR recebido por sessão (data URL) */
    qrcodes: Record<string, string>;
};

export const RealtimeContext = createContext<RealtimeValue>({ connected: false, qrcodes: {} });

export const useRealtime = () => useContext(RealtimeContext);
