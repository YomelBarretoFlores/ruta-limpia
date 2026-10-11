import { isIPv4, isIPv6 } from 'node:net';

/**
 * The network a client address belongs to, as the per-source lockout counts it: the /24 of an
 * IPv4 address (also when written IPv4-mapped, `::ffff:a.b.c.d`) and the /64 of an IPv6 address,
 * the usual allocation for one household or office line. Anything else is returned as is, cut to
 * a bounded length.
 */
export function clientNetwork(address: string): string {
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(address)?.[1];
  const ipv4 = mapped ?? address;
  if (isIPv4(ipv4)) return `${ipv4.split('.').slice(0, 3).join('.')}.0/24`;
  if (isIPv6(address)) return `${expandIPv6(address).slice(0, 4).join(':')}::/64`;
  return address.slice(0, 64);
}

/** The eight 16-bit groups of an IPv6 address, lower case without leading zeros. */
function expandIPv6(address: string): string[] {
  const withoutZone = address.split('%')[0] ?? address;
  const [head = '', tail] = withoutZone.split('::');
  const groups = (part: string) => (part === '' ? [] : part.split(':'));
  const left = groups(head);
  const right = tail === undefined ? [] : groups(tail);
  const missing = 8 - left.length - right.length;
  return [...left, ...Array<string>(Math.max(0, missing)).fill('0'), ...right].map((group) =>
    Number.parseInt(group, 16).toString(16),
  );
}
