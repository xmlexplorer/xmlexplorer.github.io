/**
 * Waits for the browser to actually paint the current frame before continuing.
 *
 * WKWebView (the macOS Tauri webview) can coalesce a state update with whatever
 * follows it in the same microtask chain, so a `setX(true)` immediately followed
 * by `await someSlowIpcCall()` sometimes never gets painted until the *next*
 * state change lands -- the loading flag is set the whole time, but the user
 * never sees it. Two nested rAFs guarantee a full paint has happened (the first
 * rAF fires before the frame is produced, the second fires after it's been
 * committed) before the slow work starts.
 */
export function paintFrame(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  });
}
