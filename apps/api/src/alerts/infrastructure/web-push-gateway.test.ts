import { describe, expect, it, vi } from 'vitest';
import { WebPushError } from 'web-push';

import { WebPushGateway, type SendNotification } from './web-push-gateway.js';

const vapid = {
  publicKey: 'public-key',
  privateKey: 'private-key',
  subject: 'mailto:ops@example.org',
};
const target = {
  endpoint: 'https://fcm.googleapis.com/fcm/send/device-1',
  p256dh: 'BPublicKey',
  auth: 'authSecret',
};
const options = { ttlSeconds: 420, urgency: 'high' as const, topic: 'point-P08' };

function gatewayWith(send: SendNotification) {
  const sendNotification = vi.fn(send);
  return {
    sendNotification,
    gateway: new WebPushGateway(vapid, { timeoutMs: 1234, sendNotification }),
  };
}

function pushServiceError(statusCode: number) {
  return new WebPushError('Received unexpected response code', statusCode, {}, '', target.endpoint);
}

describe('WebPushGateway', () => {
  it('sends the encrypted payload with VAPID, TTL, urgency, topic and timeout', async () => {
    const { gateway, sendNotification } = gatewayWith(() =>
      Promise.resolve({ statusCode: 201, body: '', headers: {} }),
    );

    await expect(gateway.send(target, '{"a":1}', options)).resolves.toEqual({ httpStatus: 201 });
    expect(sendNotification).toHaveBeenCalledWith(
      { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
      '{"a":1}',
      {
        TTL: 420,
        urgency: 'high',
        topic: 'point-P08',
        timeout: 1234,
        vapidDetails: vapid,
      },
    );
  });

  it.each([410, 404, 429, 500])(
    'resolves with the status when the push service answers %i',
    async (statusCode) => {
      const { gateway } = gatewayWith(() => Promise.reject(pushServiceError(statusCode)));

      await expect(gateway.send(target, '{}', options)).resolves.toEqual({
        httpStatus: statusCode,
      });
    },
  );

  it('rejects when no answer was received (network error or timeout)', async () => {
    const network = Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' });
    const { gateway } = gatewayWith(() => Promise.reject(network));

    await expect(gateway.send(target, '{}', options)).rejects.toBe(network);
  });
});
