import { getCurrentWebview } from '@tauri-apps/api/webview';
import { useEffect, useRef, useState } from 'react';
import { isDesktop } from '../lib/platform';

// Handles drag-and-drop of a single file, from two different sources depending on
// where we're running:
//
//  - Native (Tauri): Tauri intercepts OS file drops, so the DOM `drop` event never
//    fires with files. Its native drag-drop event is the right source and, unlike
//    the DOM, it delivers the real filesystem `paths` the Rust core parses by path.
//  - Web (browser): plain HTML5 drag/drop, which hands back File objects the web
//    engine parses directly.
//
// Either way the accepted callback gets one source (a path string or a File). We
// don't filter by extension: lots of formats are really XML (.svg, .rss, .xsl,
// .csproj, .config, ...), so we accept any single file and let the parser decide.
// The only thing rejected is a multi-file drop, since we open one document.

const MULTI_FILE_MESSAGE = 'Only a single file can be opened at a time';

export function useFileDrop(onFileAccepted: (source: string | File) => void) {
  const [isDragging, setIsDragging] = useState(false);
  const [invalidDrop, setInvalidDrop] = useState<string | undefined>(undefined);
  // Keep the latest callback in a ref so the (async) event subscription is set up
  // once on mount and never goes stale, instead of re-subscribing every render.
  const callbackRef = useRef(onFileAccepted);
  callbackRef.current = onFileAccepted;
  const invalidDropTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const flashInvalid = () => {
      setInvalidDrop(MULTI_FILE_MESSAGE);
      if (invalidDropTimer.current) {
        clearTimeout(invalidDropTimer.current);
      }
      invalidDropTimer.current = setTimeout(() => setInvalidDrop(undefined), 3000);
    };

    if (isDesktop()) {
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
              flashInvalid();
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
    }

    // Web: HTML5 drag/drop on the window. dragenter/dragover must preventDefault
    // to make the element a valid drop target. A nesting counter tracks enter/leave
    // across child elements so the overlay doesn't flicker as the pointer moves.
    let dragDepth = 0;

    const fileItemCount = (event: DragEvent) =>
      Array.from(event.dataTransfer?.items ?? []).filter((item) => item.kind === 'file').length;

    const onDragEnter = (event: DragEvent) => {
      if (fileItemCount(event) === 0) {
        return;
      }
      event.preventDefault();
      dragDepth += 1;
      // items reflect the drag's file count during the drag (files themselves
      // aren't readable until drop), so we can show valid vs. too-many feedback.
      if (fileItemCount(event) === 1) {
        setIsDragging(true);
        setInvalidDrop(undefined);
      } else {
        setIsDragging(false);
        setInvalidDrop(MULTI_FILE_MESSAGE);
      }
    };

    const onDragOver = (event: DragEvent) => {
      if (fileItemCount(event) > 0) {
        event.preventDefault();
      }
    };

    const onDragLeave = () => {
      dragDepth -= 1;
      if (dragDepth <= 0) {
        dragDepth = 0;
        setIsDragging(false);
        setInvalidDrop(undefined);
      }
    };

    const onDrop = (event: DragEvent) => {
      const files = event.dataTransfer?.files;
      if (!files || files.length === 0) {
        return;
      }
      event.preventDefault();
      dragDepth = 0;
      setIsDragging(false);
      if (files.length === 1) {
        setInvalidDrop(undefined);
        callbackRef.current(files[0]);
      } else {
        flashInvalid();
      }
    };

    window.addEventListener('dragenter', onDragEnter);
    window.addEventListener('dragover', onDragOver);
    window.addEventListener('dragleave', onDragLeave);
    window.addEventListener('drop', onDrop);

    return () => {
      window.removeEventListener('dragenter', onDragEnter);
      window.removeEventListener('dragover', onDragOver);
      window.removeEventListener('dragleave', onDragLeave);
      window.removeEventListener('drop', onDrop);
      if (invalidDropTimer.current) {
        clearTimeout(invalidDropTimer.current);
      }
    };
  }, []);

  return { isDragging, invalidDrop };
}
