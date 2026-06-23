import { beforeEach, describe, expect, it, vi } from 'vitest';

// The Rust commands are invoked through @tauri-apps/api/core. We mock it so these
// tests run without a Tauri runtime and can assert (a) the exact command name +
// argument shape sent to the backend, and (b) that the snake_case payload Rust
// emits is remapped to the camelCase shape the rest of the frontend consumes.
const invoke = vi.fn<(...args: unknown[]) => Promise<unknown>>();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invoke(...args),
}));

import { closeDocument, getChildren, openDocument } from '../lib/tauri';

beforeEach(() => {
  invoke.mockReset();
});

describe('openDocument', () => {
  it('invokes open_document_cmd with the path and maps the snake_case result', async () => {
    invoke.mockResolvedValue({
      doc_id: 7,
      root: { node_id: 0, node_type: 'element', label: '<catalog>', has_children: true },
    });

    const opened = await openDocument('/some/file.xml');

    expect(invoke).toHaveBeenCalledWith('open_document_cmd', { path: '/some/file.xml' });
    expect(opened).toEqual({
      docId: 7,
      root: { nodeId: 0, nodeType: 'element', label: '<catalog>', hasChildren: true },
    });
  });
});

describe('closeDocument', () => {
  it('invokes close_document_cmd with the docId', async () => {
    invoke.mockResolvedValue(undefined);
    await closeDocument(42);
    expect(invoke).toHaveBeenCalledWith('close_document_cmd', { docId: 42 });
  });
});

describe('getChildren', () => {
  it('forwards docId/nodeId/offset and maps the page + its items', async () => {
    invoke.mockResolvedValue({
      items: [{ node_id: 3, node_type: 'element', label: '<book>', has_children: false }],
      offset: 500,
      total: 1200,
      has_more: true,
    });

    const page = await getChildren(1, 2, 500);

    expect(invoke).toHaveBeenCalledWith('get_children_cmd', { docId: 1, nodeId: 2, offset: 500 });
    expect(page).toEqual({
      items: [{ nodeId: 3, nodeType: 'element', label: '<book>', hasChildren: false }],
      offset: 500,
      total: 1200,
      hasMore: true,
    });
  });

  it('defaults offset to 0 when omitted', async () => {
    invoke.mockResolvedValue({ items: [], offset: 0, total: 0, has_more: false });
    await getChildren(1, 2);
    expect(invoke).toHaveBeenCalledWith('get_children_cmd', { docId: 1, nodeId: 2, offset: 0 });
  });

  it('maps has_more: false to hasMore: false', async () => {
    invoke.mockResolvedValue({ items: [], offset: 0, total: 3, has_more: false });
    const page = await getChildren(1, 2, 0);
    expect(page.hasMore).toBe(false);
  });
});
