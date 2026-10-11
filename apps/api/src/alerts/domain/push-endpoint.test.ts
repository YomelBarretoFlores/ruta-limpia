import { describe, expect, it } from 'vitest';

import { isAllowedPushEndpoint } from './push-endpoint.js';

describe('isAllowedPushEndpoint', () => {
  it.each([
    'https://fcm.googleapis.com/fcm/send/abc123',
    'https://updates.push.services.mozilla.com/wpush/v2/gAAAA',
    'https://web.push.apple.com/QGuQyavXutnMH',
    'https://wns2-by3p.notify.windows.com/w/?token=BQYAAAB',
  ])('accepts the browser push service endpoint %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(true);
  });

  it.each([
    'http://fcm.googleapis.com/fcm/send/abc123',
    'https://evil.example/fcm.googleapis.com',
    'https://fcm.googleapis.com.evil.example/send',
    'https://notfcm.googleapis.com/send',
    'https://user:pass@fcm.googleapis.com/send',
    'https://10.0.0.5/internal',
    'not a url',
  ])('rejects %s', (endpoint) => {
    expect(isAllowedPushEndpoint(endpoint)).toBe(false);
  });

  it('uses the given host list', () => {
    expect(isAllowedPushEndpoint('https://push.example.org/x', ['push.example.org'])).toBe(true);
    expect(isAllowedPushEndpoint('https://fcm.googleapis.com/x', ['push.example.org'])).toBe(false);
  });
});
