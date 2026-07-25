// Distinguishes the native (Tauri) build from the plain-browser build so the
// engine facade, file-open flow, and external-link handling can pick the right
// implementation at runtime. Tauri v2 injects `__TAURI_INTERNALS__` onto the
// webview's `window` before any app script runs, so its presence is a reliable
// "am I inside the native app?" signal.
export function isDesktop(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

/**
 * Opens a URL outside the app: the system browser when running natively, a new
 * tab on web. Native needs the opener plugin because the Tauri webview ignores
 * `target="_blank"` -- a plain <a> there does nothing at best, and navigates
 * the app's own window away at worst.
 */
export function openExternal(url: string): void {
  if (isDesktop()) {
    void import('@tauri-apps/plugin-opener').then(({ openUrl }) => openUrl(url));
  } else {
    window.open(url, '_blank', 'noopener');
  }
}

/**
 * The version of the running native (Tauri) app, read from its bundled
 * tauri.conf.json. Dynamically imports the Tauri API so plain-browser builds
 * never pull it in. Only call when `isDesktop()` is true.
 */
export async function getNativeVersion(): Promise<string> {
  const { getVersion } = await import('@tauri-apps/api/app');
  return getVersion();
}
