# XML Explorer

XML Explorer is an extremely fast, lightweight XML file viewer built for very large XML
files. It offers fast viewing and exploration, copying of formatted XML, XPath evaluation,
and XSD schema validation.

It ships in three editions:

- **Web** — runs in the browser at [xmlexplorer.github.io](https://xmlexplorer.github.io),
  nothing to install.
- **Cross-platform desktop** — a [Tauri](https://tauri.app) app (React frontend + a Rust /
  libxml2 engine) for macOS, Linux, and Windows.
- **Windows (legacy)** — the original .NET (WPF) app.

See the [About page](https://xmlexplorer.github.io/about.html) for a side-by-side comparison.

This repo holds the web app (React + Vite, [`src/`](src/)) and the native app (Tauri,
[`native/`](native/)); the same React frontend powers both. The web app is deployed to
GitHub Pages by [`.github/workflows/deploy-pages.yml`](.github/workflows/deploy-pages.yml)
on every push to `master`.

## Versioning

Three separate values track "version," each with its own job:

| Source | Field | Used for |
| --- | --- | --- |
| [`package.json`](package.json) | `version` | The web app's **display** version, shown in the About menu (`__APP_VERSION__`) and written to `version.json` as `version`. Not used for update detection. |
| [`native/tauri.conf.json`](native/tauri.conf.json) | `version` | The **native** app's version. Also published to `version.json` as `nativeVersion`, which drives the native in-app update notification. |
| git commit hash | — | Baked into each web build (`__GIT_HASH__`). The **web** update notification fires when the deployed hash differs from the running build's, so plain web deploys need no version bump. |

Keep the first two in sync with one command:

```bash
npm run set-version 0.1.2
```

This writes the same version into both `package.json` and `native/tauri.conf.json`
([`scripts/set-version.mjs`](scripts/set-version.mjs)). Only bump these when cutting a
release — a version bump to `tauri.conf.json` tells every installed native app an update is
available, so don't bump it for web-only changes.

## Native App Release Process

The native desktop apps are built and published by the
[`Build & Release Native App`](.github/workflows/native-release.yml) workflow. A release is
triggered by pushing a tag named `native-v<version>`.

### Cutting a release

1. Pick the new version (semver, e.g. `0.1.2`).

2. Set it in both `package.json` and `native/tauri.conf.json`, then push to `master`:

   ```bash
   npm run set-version 0.1.2
   git commit -am "Release 0.1.2"
   git push
   ```

   Pushing to `master` redeploys the web app and republishes `version.json` with the new
   `nativeVersion`, so running native apps on an older version show the in-app "update
   available" notification pointing to the About page — see
   [`src/hooks/useUpdateCheck.ts`](src/hooks/useUpdateCheck.ts). Skip this step and existing
   installs won't be notified of the new release.

3. Create and push the matching tag:

   ```bash
   git tag native-v0.1.2
   git push origin native-v0.1.2
   ```

4. The tag runs the workflow, which:
   - runs the full test suite (`npm test`, including the Rust tests);
   - builds installers for macOS (`aarch64` + `x86_64`), Linux (`x86_64`), and Windows
     (`x86_64`) — the version is taken from the tag (`native-v0.1.2` → `0.1.2`) and written
     into `tauri.conf.json` for the build;
   - creates a GitHub Release named `XML Explorer Native App 0.1.2` and attaches every
     installer: `.dmg`, `.app.tar.gz`, `.AppImage`, `.deb`, `.rpm`, `.msi`, and `setup.exe`.

The About page's **Cross Platform → Download** button links to the
[Releases page](https://github.com/xmlexplorer/xmlexplorer.github.io/releases), so no page
edit is needed after a release.

### Dry-run build (no release)

To test the build without publishing, start the workflow manually from the **Actions** tab
(`workflow_dispatch`) and leave the **tag** input blank. It builds all platforms and uploads
the installers as workflow artifacts, but skips creating a release.

### Notes

- The build version comes from the tag, not the committed file — so the tagged commit doesn't
  strictly need the version bump in step 2. Keeping `native/tauri.conf.json` in sync is what
  drives the in-app update notification, which is why the bump is its own step.
- Builds are currently unsigned, so macOS and Windows show an "unidentified developer" warning
  on first launch.
