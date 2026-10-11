import { describe, expect, it, vi } from 'vitest';

import type { StoredSubscription } from '../citizen/push/subscription-store';
import { handleAlertPush, openAlertPage, type PushHandlerDeps } from './push-handlers';

const subscription: StoredSubscription = {
  subscriptionId: 'sub-1',
  managementToken: 'token-1',
  pointCode: 'P08',
  routeCode: 'RI-01',
};

const payload = {
  type: 'proximity_alert',
  alertId: 'alert-1',
  subscriptionId: 'sub-1',
  pointCode: 'P08',
  title: 'Ruta Limpia: el camión se acerca',
  body: 'El camión recolector pasará por P08 en ~8 min (aprox. 17:38).',
  url: '/?p=P08',
};

function deps(overrides: Partial<PushHandlerDeps> = {}) {
  return {
    showNotification: vi.fn<PushHandlerDeps['showNotification']>(() => Promise.resolve()),
    loadSubscription: vi.fn(() => Promise.resolve<StoredSubscription | null>(subscription)),
    fetch: vi.fn<PushHandlerDeps['fetch']>(() =>
      Promise.resolve(new Response(null, { status: 204 })),
    ),
    ...overrides,
  };
}

describe('handleAlertPush', () => {
  it('shows one notification per point and confirms the receipt', async () => {
    const d = deps();

    await handleAlertPush(payload, d);

    expect(d.showNotification).toHaveBeenCalledWith(payload.title, {
      body: payload.body,
      tag: 'ruta-limpia-P08',
      renotify: true,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      lang: 'es-PE',
      data: { url: '/?p=P08', alertId: 'alert-1' },
    });
    expect(d.fetch).toHaveBeenCalledWith('/api/alerts/alert-1/receipts', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ subscriptionId: 'sub-1', managementToken: 'token-1' }),
    });
  });

  it('never throws when the receipt cannot be sent', async () => {
    const d = deps({ fetch: vi.fn(() => Promise.reject(new TypeError('offline'))) });

    await expect(handleAlertPush(payload, d)).resolves.toBeUndefined();
    expect(d.showNotification).toHaveBeenCalledOnce();
  });

  it('shows a default alert for an odd payload and never opens another site', async () => {
    const d = deps({ loadSubscription: vi.fn(() => Promise.resolve(null)) });

    await handleAlertPush({ url: 'https://evil.example/' }, d);

    expect(d.showNotification).toHaveBeenCalledWith(
      'Ruta Limpia',
      expect.objectContaining({ data: { url: '/', alertId: null } }),
    );
    expect(d.fetch).not.toHaveBeenCalled();
  });
});

describe('openAlertPage', () => {
  const origin = 'https://rutalimpia.example';

  it('focuses an open window of the app after showing the point', async () => {
    const client = {
      url: `${origin}/`,
      focus: vi.fn(() => Promise.resolve()),
      navigate: vi.fn(() => Promise.resolve()),
    };
    const clients = {
      matchAll: vi.fn(() => Promise.resolve([client])),
      openWindow: vi.fn(() => Promise.resolve()),
    };

    await openAlertPage('/?p=P08', clients, origin);

    expect(client.navigate).toHaveBeenCalledWith(`${origin}/?p=P08`);
    expect(client.focus).toHaveBeenCalled();
    expect(clients.openWindow).not.toHaveBeenCalled();
  });

  it('opens a window when none is open', async () => {
    const clients = {
      matchAll: vi.fn(() => Promise.resolve([])),
      openWindow: vi.fn(() => Promise.resolve()),
    };

    await openAlertPage('/?p=P08', clients, origin);

    expect(clients.openWindow).toHaveBeenCalledWith(`${origin}/?p=P08`);
  });
});
