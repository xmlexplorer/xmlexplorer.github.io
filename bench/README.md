# XML Explorer engine benchmark

Compares candidate XML engines on real hardware, to inform whether XML Explorer
stays a native Tauri app (current: libxml2) or moves to a web app (which would
need a pure-Rust/WASM engine like xmloxide, or the browser's own native parser).

## 1. Native engine comparison (libxml2 vs xmloxide)

Download the `xmlexplorer-bench` binary for your platform from the
"Build Cross-Platform Engine Benchmark" GitHub Actions run, then:

```sh
# generate a ~200MB fixture matching the one used in the original spikes
./xmlexplorer-bench --generate fixture.xml

# run the comparison
./xmlexplorer-bench fixture.xml
```

Prints parse time, XPath (`//item`) time, and current RSS for both libxml2
(the current native app's engine) and xmloxide (the pure-Rust alternative),
back to back, same process.

Unsigned binary notes:
- **macOS**: first run will likely be Gatekeeper-blocked. Right-click > Open
  once, or `xattr -d com.apple.quarantine ./xmlexplorer-bench`.
- **Windows**: SmartScreen may warn on the unsigned `.exe`. Click "Run anyway".
- **Linux/SteamOS**: `chmod +x ./xmlexplorer-bench` if needed.

## 2. Browser-native comparison (DOMParser / document.evaluate)

No compilation needed -- runs in any browser, on anything, including the
Steam Deck.

1. Generate (or reuse) a fixture with the native tool above, naming it
   exactly `fixture.xml`.
2. Copy it into this `bench/browser/` folder, next to `index.html`.
3. Serve this folder locally (fetching `file://` directly is blocked by most
   browsers' security model):
   ```sh
   cd bench/browser
   python3 -m http.server 8843
   ```
4. Open `http://localhost:8843/` in the browser you want to test.
5. Once it finishes, check that browser's *own* task manager for the real
   memory figure -- the page's own `JS heap used` reading is misleadingly
   low (the parsed DOM lives in the browser engine's native heap, not the JS
   heap that `performance.memory` reports).
