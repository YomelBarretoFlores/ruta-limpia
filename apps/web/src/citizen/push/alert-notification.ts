/**
 * The proximity alert push payload (see the README, "Web Push subscriptions") and the
 * notification shown for it. Shared by the service worker; no DOM APIs here.
 */
export interface AlertPayload {
  readonly alertId: string | null;
  readonly pointCode: string | null;
  readonly title: string;
  readonly body: string;
  /** Same-origin path opened when the notification is tapped. */
  readonly url: string;
}

const DEFAULT_TITLE = 'Ruta Limpia';
const DEFAULT_BODY =
  'El camión recolector se acerca a tu punto. Saca tus residuos en bolsas cerradas.';

export const NOTIFICATION_ICON = '/icons/icon-192.png';

/** Reads a push payload defensively: missing or odd fields fall back to safe defaults. */
export function parseAlertPayload(data: unknown): AlertPayload {
  const value = typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
  const text = (key: string) => {
    const field = value[key];
    return typeof field === 'string' && field.trim().length > 0 ? field : null;
  };
  return {
    alertId: text('alertId'),
    pointCode: text('pointCode'),
    title: text('title') ?? DEFAULT_TITLE,
    body: text('body') ?? DEFAULT_BODY,
    url: safePath(text('url')),
  };
}

/** Only same-origin paths (`/…`, never `//host`) can be opened from a notification. */
function safePath(url: string | null): string {
  return url !== null && url.startsWith('/') && !url.startsWith('//') ? url : '/';
}

/** `renotify` is still honored by Chromium browsers but missing from the TypeScript DOM types. */
export type AlertNotificationOptions = NotificationOptions & { readonly renotify: boolean };

/**
 * One notification per point (`tag`): a newer alert for the same point replaces the older one
 * and still alerts the household (`renotify`).
 */
export function alertNotificationOptions(payload: AlertPayload): AlertNotificationOptions {
  return {
    body: payload.body,
    tag: `ruta-limpia-${payload.pointCode ?? 'alerta'}`,
    renotify: true,
    icon: NOTIFICATION_ICON,
    badge: NOTIFICATION_ICON,
    lang: 'es-PE',
    data: { url: payload.url, alertId: payload.alertId },
  };
}
