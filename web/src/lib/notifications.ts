/** Notificação do navegador quando a aba não está visível. */
export function notify(title: string, body: string, onClick: () => void) {
    if (typeof Notification === 'undefined' || Notification.permission !== 'granted' || !document.hidden) return;
    try {
        const notification = new Notification(title, { body, icon: '/favicon.svg', tag: title });
        notification.onclick = () => {
            window.focus();
            onClick();
            notification.close();
        };
    } catch {
        // alguns navegadores móveis só notificam via service worker
    }
}

export const notificationsSupported = () => typeof Notification !== 'undefined';
