import { CircleAlert, CircleCheck, CircleDashed, LoaderCircle, QrCode } from 'lucide-react';
import type { SessionState } from './types';

type Tone = 'success' | 'warning' | 'info' | 'neutral' | 'danger';

/** Rótulo, cor e ícone de cada estado (cor nunca sozinha: sempre com texto e ícone). */
export function stateInfo(state: SessionState): { label: string; tone: Tone; icon: typeof CircleCheck } {
    switch (state) {
        case 'CONNECTED':
            return { label: 'Conectada', tone: 'success', icon: CircleCheck };
        case 'QRCODE':
            return { label: 'Aguardando QR', tone: 'warning', icon: QrCode };
        case 'STARTING':
        case 'OPENING':
        case 'PAIRING':
        case 'SYNCING':
            return { label: 'Iniciando', tone: 'info', icon: LoaderCircle };
        case 'CLOSED':
            return { label: 'Fechada', tone: 'neutral', icon: CircleDashed };
        default:
            // CONFLICT, UNPAIRED, UNLAUNCHED, DISCONNECTED...
            return { label: 'Atenção: ' + state, tone: 'danger', icon: CircleAlert };
    }
}

export const SESSION_NAME = /^[A-Za-z0-9_-][A-Za-z0-9_.-]{0,63}$/;
