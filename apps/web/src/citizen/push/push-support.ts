/**
 * `supported`: the browser can receive Web Push; `ios_install`: iPhone/iPad Safari outside the
 * installed app (Web Push works only from the home screen, iOS/iPadOS 16.4+); `unsupported`:
 * no Web Push in this browser.
 */
export type PushSupport = 'supported' | 'ios_install' | 'unsupported';

export interface PushCapabilities {
  readonly userAgent: string;
  readonly platform: string;
  readonly maxTouchPoints: number;
  /** Running as the installed app (home screen). */
  readonly standalone: boolean;
  readonly serviceWorker: boolean;
  readonly pushManager: boolean;
  readonly notification: boolean;
}

export function detectPushSupport(capabilities: PushCapabilities): PushSupport {
  const { userAgent, platform, maxTouchPoints, standalone } = capabilities;
  // iPadOS reports itself as a Mac; touch support gives it away.
  const ios = /iPad|iPhone|iPod/.test(userAgent) || (platform === 'MacIntel' && maxTouchPoints > 1);
  if (ios && !standalone) return 'ios_install';
  return capabilities.serviceWorker && capabilities.pushManager && capabilities.notification
    ? 'supported'
    : 'unsupported';
}

/** The capabilities of the current browser. */
export function browserPushCapabilities(): PushCapabilities {
  const nav = navigator as Navigator & { standalone?: boolean };
  return {
    userAgent: nav.userAgent,
    platform: nav.platform,
    maxTouchPoints: nav.maxTouchPoints,
    standalone:
      nav.standalone === true || window.matchMedia?.('(display-mode: standalone)').matches === true,
    serviceWorker: 'serviceWorker' in nav,
    pushManager: 'PushManager' in window,
    notification: 'Notification' in window,
  };
}
