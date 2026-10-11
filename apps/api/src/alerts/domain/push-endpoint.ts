/**
 * Hosts of the browser push services (Chrome/Edge/Opera via FCM, Firefox, Safari, Windows). The API
 * posts to subscription endpoints, so accepting any URL would let anyone make the server send
 * requests to arbitrary hosts.
 */
export const DEFAULT_PUSH_SERVICE_HOSTS: readonly string[] = Object.freeze([
  'fcm.googleapis.com',
  'push.services.mozilla.com',
  'push.apple.com',
  'notify.windows.com',
]);

/** True when `endpoint` is an HTTPS URL on one of `allowedHosts` or one of their subdomains. */
export function isAllowedPushEndpoint(
  endpoint: string,
  allowedHosts: readonly string[] = DEFAULT_PUSH_SERVICE_HOSTS,
): boolean {
  let url: URL;
  try {
    url = new URL(endpoint);
  } catch {
    return false;
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') return false;
  const host = url.hostname.toLowerCase();
  return allowedHosts.some((allowed) => host === allowed || host.endsWith(`.${allowed}`));
}
