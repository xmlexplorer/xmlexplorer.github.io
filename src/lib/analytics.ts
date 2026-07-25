import { isDesktop } from './platform';

/**
 * GA4 measurement ID (the `G-XXXXXXXXXX` from the property's web data stream).
 * The same property about.html reports into, so app and marketing-page traffic
 * land together; split them by hostname or page path in GA4 if that ever gets
 * noisy. Empty disables analytics completely -- nothing is injected and no
 * requests are made.
 */
const MEASUREMENT_ID = 'G-RYWX65C7ZL';

const GTAG_SRC = `https://www.googletagmanager.com/gtag/js?id=${MEASUREMENT_ID}`;

declare global {
  interface Window {
    dataLayer?: unknown[];
  }
}

/**
 * Loads GA4 and records the initial page view.
 *
 * Web-only, for the same reason the ad script is: index.html is shared with the
 * Tauri build, and a desktop app shouldn't phone home to Google on launch. The
 * app is a single page that never navigates, so this produces exactly one
 * page_view per session and nothing else.
 *
 * Consent is handled by Google's CMP with consent mode enabled in AdSense's
 * Privacy & messaging, rather than by hand-written `gtag('consent', 'default',
 * ...)` calls here -- getting the region scoping wrong either loses analytics
 * data worldwide or under-protects EEA users, and the CMP already knows which
 * visitors are in scope.
 */
export function initAnalytics(): void {
  if (isDesktop() || !MEASUREMENT_ID || document.querySelector(`script[src="${GTAG_SRC}"]`)) {
    return;
  }

  const script = document.createElement('script');
  script.async = true;
  script.src = GTAG_SRC;
  document.head.appendChild(script);

  gtag('js', new Date());
  gtag('config', MEASUREMENT_ID);
}

// gtag.js reads its queue off window.dataLayer, so calls made before the script
// finishes loading are picked up once it does.
function gtag(...args: unknown[]): void {
  window.dataLayer = window.dataLayer || [];
  window.dataLayer.push(args);
}
