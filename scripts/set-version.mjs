// Sets the project version in both package.json and native/tauri.conf.json so the
// web display version and the native release/update version stay in sync.
//
//   node scripts/set-version.mjs 0.1.2      (or: npm run set-version 0.1.2)
//
// Only the version string is rewritten, so each file keeps its existing formatting.
import { readFileSync, writeFileSync } from 'node:fs';

const version = process.argv[2];
if (!version || !/^\d+\.\d+\.\d+$/.test(version)) {
  console.error('Usage: node scripts/set-version.mjs <major.minor.patch>   e.g. 0.1.2');
  process.exit(1);
}

// Replace the first `"version": "..."` in each file (the package/app version,
// which sits at the top -- before any nested version-like fields).
const VERSION_RE = /("version"\s*:\s*)"[^"]*"/;

for (const path of ['package.json', 'native/tauri.conf.json']) {
  const raw = readFileSync(path, 'utf8');
  if (!VERSION_RE.test(raw)) {
    console.error(`no "version" field found in ${path}`);
    process.exit(1);
  }
  writeFileSync(path, raw.replace(VERSION_RE, `$1"${version}"`));
  console.log(`updated ${path} -> ${version}`);
}
