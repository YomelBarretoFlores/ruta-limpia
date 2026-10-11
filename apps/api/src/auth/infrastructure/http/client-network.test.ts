import { describe, expect, it } from 'vitest';

import { clientNetwork } from './client-network.js';

describe('clientNetwork', () => {
  it('groups IPv4 clients by /24, also when IPv4-mapped', () => {
    expect(clientNetwork('190.40.12.77')).toBe('190.40.12.0/24');
    expect(clientNetwork('::ffff:190.40.12.5')).toBe('190.40.12.0/24');
  });

  it('groups IPv6 clients by /64, whatever the notation', () => {
    expect(clientNetwork('2800:200:e840:1a2b:1:2:3:4')).toBe('2800:200:e840:1a2b::/64');
    expect(clientNetwork('2800:0200:E840:1A2B::99')).toBe('2800:200:e840:1a2b::/64');
    expect(clientNetwork('2800::1')).toBe('2800:0:0:0::/64');
    expect(clientNetwork('::1')).toBe('0:0:0:0::/64');
  });

  it('keeps an unrecognized address, bounded', () => {
    expect(clientNetwork('unix-socket')).toBe('unix-socket');
    expect(clientNetwork('x'.repeat(500))).toHaveLength(64);
  });
});
