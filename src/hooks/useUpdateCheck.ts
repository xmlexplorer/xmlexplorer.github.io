import { useEffect, useState } from 'react';
import { getNativeVersion, isDesktop } from '../lib/platform';
import { compareVersions, type VersionInfo } from '../lib/version';

/** How often to poll for a newer version, in milliseconds. */
const CHECK_INTERVAL_MS = 30 * 60 * 1000;

// The native app bundles its frontend locally, so a relative version.json would
// only ever report the *installed* build. To learn the latest released native
// version it must read the live site's copy at an absolute URL.
const LIVE_VERSION_URL = 'https://xmlexplorer.github.io/version.json';

export type UpdateType = 'web' | 'native';

async function fetchVersionInfo(native: boolean): Promise<VersionInfo | null> {
  try {
    const base = native ? LIVE_VERSION_URL : `${__BASE_URL__}version.json`;
    const res = await fetch(`${base}?ts=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return (await res.json()) as VersionInfo;
  } catch {
    return null;
  }
}

/**
 * Polls the deployed version.json and reports when an update is available.
 *
 * - Web: compares the deployed commit hash against the one baked into this build.
 *   A mismatch means a newer build has been deployed → reload to update.
 * - Native: the frontend is bundled into the app, so only the native shell can be
 *   out of date. Compares the latest released native version against the installed
 *   one → download the new app from the about page.
 *
 * Returns the update type once detected, otherwise null.
 */
export function useUpdateCheck(): UpdateType | null {
  const [updateType, setUpdateType] = useState<UpdateType | null>(null);

  useEffect(() => {
    let cancelled = false;
    const native = isDesktop();

    const check = async () => {
      const info = await fetchVersionInfo(native);
      if (!info || cancelled) return;

      if (native) {
        try {
          const current = await getNativeVersion();
          if (!cancelled && info.nativeVersion && compareVersions(info.nativeVersion, current) > 0) {
            setUpdateType('native');
          }
        } catch {
          // Ignore — can't determine the installed native version.
        }
      } else if (info.commit && info.commit !== __GIT_HASH__) {
        setUpdateType('web');
      }
    };

    void check();
    const interval = setInterval(() => void check(), CHECK_INTERVAL_MS);
    const onVisible = () => {
      if (document.visibilityState === 'visible') void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);

    return () => {
      cancelled = true;
      clearInterval(interval);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, []);

  return updateType;
}
