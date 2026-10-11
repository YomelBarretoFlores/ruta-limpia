import {
  alertNotificationOptions,
  parseAlertPayload,
  type AlertNotificationOptions,
  type AlertPayload,
} from '../citizen/push/alert-notification';
import type { StoredSubscription } from '../citizen/push/subscription-store';

export interface PushHandlerDeps {
  showNotification(title: string, options: AlertNotificationOptions): Promise<void>;
  loadSubscription(): Promise<StoredSubscription | null>;
  fetch(input: string, init: RequestInit): Promise<Response>;
}

/**
 * A proximity alert arrived: show it, then confirm the reception to the API (best effort: a
 * failed confirmation never hides the notification and never throws).
 */
export async function handleAlertPush(data: unknown, deps: PushHandlerDeps): Promise<void> {
  const payload = parseAlertPayload(data);
  await deps.showNotification(payload.title, alertNotificationOptions(payload));
  await confirmReceipt(payload, deps);
}

async function confirmReceipt(payload: AlertPayload, deps: PushHandlerDeps): Promise<void> {
  if (payload.alertId === null) return;
  try {
    const subscription = await deps.loadSubscription();
    if (subscription === null) return;
    await deps.fetch(`/api/alerts/${encodeURIComponent(payload.alertId)}/receipts`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        subscriptionId: subscription.subscriptionId,
        managementToken: subscription.managementToken,
      }),
    });
  } catch {
    // "Recepción confirmada cuando sea técnicamente posible": a lost receipt is acceptable.
  }
}

export interface WindowClientLike {
  readonly url: string;
  focus(): Promise<unknown>;
  navigate(url: string): Promise<unknown>;
}

export interface ClientsLike {
  matchAll(options: {
    type: 'window';
    includeUncontrolled: boolean;
  }): Promise<readonly WindowClientLike[]>;
  openWindow(url: string): Promise<unknown>;
}

/**
 * Focuses an open window of the app on `path` (navigating it if needed), or opens one. A window
 * the service worker does not control rejects `navigate()`: then a new window opens on the
 * alert, so the tap always shows the alerted point.
 */
export async function openAlertPage(path: string, clients: ClientsLike, origin: string) {
  const target = new URL(path, origin).href;
  const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
  const open = windows.find((client) => new URL(client.url).origin === origin);
  if (open === undefined) {
    await clients.openWindow(target);
    return;
  }
  if (open.url !== target) {
    const navigated = await open.navigate(target).then(
      () => true,
      () => false,
    );
    if (!navigated) {
      await clients.openWindow(target);
      return;
    }
  }
  await open.focus();
}
