import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useEffect, useRef, useState } from 'react';

// We need the dropped file's real filesystem path (the Rust side parses by path),
// which the HTML5 drag/drop DOM events never expose -- and Tauri intercepts OS file
// drops by default, so the DOM `drop` event wouldn't even fire with files. Tauri's
// native drag-drop event is the right source: it delivers the actual `paths`.
//
// We don't filter by extension: lots of formats are really XML (.svg, .rss, .xsl,
// .csproj, .config, ...), so we accept any single file and let the parser decide.
// The only thing rejected is a multi-file drop, since we open one document.

const MULTI_FILE_MESSAGE = 'Only a single file can be opened at a time';

export function useFileDrop(onFileAccepted: (path: string) => void) {
  const [isDragging, setIsDragging] = useState(false);
  const [invalidDrop, setInvalidDrop] = useState<string | undefined>(undefined);
  // Keep the latest callback in a ref so the (async) event subscription is set up
  // once on mount and never goes stale, instead of re-subscribing every render.
  const callbackRef = useRef(onFileAccepted);
  callbackRef.current = onFileAccepted;
  const invalidDropTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const unlistenPromise = getCurrentWebview().onDragDropEvent((event) => {
      const payload = event.payload;
      switch (payload.type) {
        case 'enter': {
          // `enter` carries the paths, so we can show valid (drop here) vs invalid
          // (too many files) feedback live during the drag.
          if (payload.paths.length === 1) {
            setIsDragging(true);
            setInvalidDrop(undefined);
          } else {
            setIsDragging(false);
            setInvalidDrop(MULTI_FILE_MESSAGE);
          }
          break;
        }
        case 'over':
          // Position-only updates -- keep whatever `enter` decided.
          break;
        case 'leave':
          setIsDragging(false);
          setInvalidDrop(undefined);
          break;
        case 'drop': {
          setIsDragging(false);
          if (payload.paths.length === 1) {
            setInvalidDrop(undefined);
            callbackRef.current(payload.paths[0]);
          } else {
            setInvalidDrop(MULTI_FILE_MESSAGE);
            if (invalidDropTimer.current) {
              clearTimeout(invalidDropTimer.current);
            }
            invalidDropTimer.current = setTimeout(() => setInvalidDrop(undefined), 3000);
          }
          break;
        }
      }
    });

    return () => {
      void unlistenPromise.then((unlisten) => unlisten());
      if (invalidDropTimer.current) {
        clearTimeout(invalidDropTimer.current);
      }
    };
  }, []);

  return { isDragging, invalidDrop };
}
