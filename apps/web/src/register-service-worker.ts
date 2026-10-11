import { registerSW } from 'virtual:pwa-register';

/**
 * Registers the service worker (app shell cache, push notifications). Browsers without service
 * workers keep working online; alerts are then unavailable and the page says so.
 */
export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  registerSW({
    immediate: true,
    onRegisterError: (error: unknown) => console.error('Service worker registration failed', error),
  });
}
