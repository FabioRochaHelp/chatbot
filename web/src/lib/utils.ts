import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
    return twMerge(clsx(inputs));
}

const number = new Intl.NumberFormat('pt-BR');
export const formatNumber = (value: number) => number.format(value);

/** 5563999999999@c.us -> +55 63 99999-9999 (melhor esforço; grupos e ids desconhecidos voltam como vieram). */
export function formatWaId(waId: string) {
    if (/@g\.us$/.test(waId)) return 'Grupo do WhatsApp';
    const digits = waId.replace(/@.*$/, '');
    if (!/@c\.us$/.test(waId) || !/^\d+$/.test(digits)) return waId;
    const match = digits.match(/^55(\d{2})(\d{4,5})(\d{4})$/);
    return match ? `+55 ${match[1]} ${match[2]}-${match[3]}` : '+' + digits;
}

export function relativeTime(date: string | Date) {
    const diff = (new Date(date).getTime() - Date.now()) / 1000;
    const format = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
    const units: [Intl.RelativeTimeFormatUnit, number][] = [
        ['day', 86400],
        ['hour', 3600],
        ['minute', 60]
    ];
    for (const [unit, seconds] of units) {
        if (Math.abs(diff) >= seconds) return format.format(Math.round(diff / seconds), unit);
    }
    return 'agora';
}

/** Arquivo -> base64 (data URL), para enviar no JSON da API. */
export function fileToDataUrl(file: File) {
    return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(file);
    });
}
