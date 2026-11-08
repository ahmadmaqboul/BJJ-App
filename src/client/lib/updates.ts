/// <reference types="vite-plugin-pwa/client" />
import { registerSW } from 'virtual:pwa-register';

/**
 * Keeping an installed app up to date.
 *
 * A service worker that merely registers is not enough: a new worker can
 * install and even take over while the page that is already open goes on
 * running the old JavaScript. On a phone a PWA is usually resumed rather than
 * launched afresh, so without this an installed app can sit on a stale version
 * for days, and the only cure is to fully close it — twice, since the first
 * open only fetches the new worker.
 *
 * So: check for a new version whenever the app comes back to the foreground
 * and periodically while it is open, then tell the user and let THEM apply it.
 * It deliberately does not reload on its own — this app is used mid-register
 * and mid-form, and swapping the page underneath someone taking attendance
 * would lose what they had typed.
 */

/** How often to look for a new version while the app stays open. */
const CHECK_EVERY_MS = 30 * 60 * 1000;

export function watchForUpdates(onUpdateReady: (apply: () => void) => void): void {
  const updateSW = registerSW({
    immediate: true,

    onNeedRefresh() {
      // updateSW(true) tells the waiting worker to take over, then reloads.
      onUpdateReady(() => void updateSW(true));
    },

    onRegisteredSW(_url, registration) {
      if (!registration) return;

      const check = () => {
        // An update check offline just fails noisily for nothing.
        if (navigator.onLine) void registration.update().catch(() => {});
      };

      // The moment that matters most on a phone: the app being reopened.
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) check();
      });
      window.addEventListener('online', check);
      setInterval(check, CHECK_EVERY_MS);
    },
  });
}
