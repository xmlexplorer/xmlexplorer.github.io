// The app is bundled locally so it works fully offline, but AdSense requires a real,
// registered origin to serve ads -- it won't reliably render against a `tauri://localhost`
// or local-file origin. Loading the ad unit from the live, already-verified site via iframe
// gets real ads while everything else stays local; if there's no network, this iframe alone
// goes blank and the rest of the app is unaffected.
const AD_FRAME_URL = 'https://xmlexplorer.github.io/ad-frame.html';

export function AdBar() {
  return (
    <iframe
      src={AD_FRAME_URL}
      title="Advertisement"
      style={{ width: '100%', height: 90, border: 'none', flexShrink: 0 }}
    />
  );
}
