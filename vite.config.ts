import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';
import { version } from './package.json';

function getGitHash() {
  try {
    return execSync('git rev-parse --short HEAD').toString().trim();
  } catch {
    return 'unknown';
  }
}

function getNativeVersion() {
  try {
    return (JSON.parse(readFileSync('./native/tauri.conf.json', 'utf8')) as { version: string }).version;
  } catch {
    return version;
  }
}

// Emits a version.json at the site root at build time so the running app can
// detect when a newer build has been deployed (web) or a newer native version
// released (native). See src/hooks/useUpdateCheck.ts.
function emitVersionJson(): Plugin {
  return {
    name: 'emit-version-json',
    generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'version.json',
        source: JSON.stringify({
          version,
          commit: getGitHash(),
          nativeVersion: getNativeVersion(),
        }),
      });
    },
  };
}

// `index.html` at the project root is the React web app's entry point -- the
// site's default page -- and is what `native/tauri.conf.json` loads too. The old
// Windows marketing/download page lives at `public/about.html` (a plain static
// page, not a Vite entry), along with the download assets it references,
// `ads.txt`, and the favicon: Vite copies all of `public/` to the site root.
//
// The native build (`--mode native`) drops `public/` entirely: Tauri bundles
// `dist/` into the app, and none of those files -- a web marketing page, an
// ads.txt, and ~2 MB of Windows installer downloads -- belong in a shipped
// desktop binary.
export default defineConfig(({ mode }) => ({
  define: {
    __APP_VERSION__: JSON.stringify(version),
    __GIT_HASH__: JSON.stringify(getGitHash()),
    __BASE_URL__: JSON.stringify('/'),
  },
  publicDir: mode === 'native' ? false : 'public',
  plugins: [react(), emitVersionJson()],
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: 'index.html',
    },
  },
}));
