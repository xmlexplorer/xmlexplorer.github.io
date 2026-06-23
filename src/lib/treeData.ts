import type { TreeDataNode } from 'antd';
import type { Key } from 'react';
import type { NodeSummary } from './tauri';

// Some real documents have nodes with millions of direct children (a flat list of
// sibling records). get_children already returns those in bounded pages rather than
// all at once -- this is the UI-side half of that: a clickable placeholder node that
// fetches and splices in the next page, instead of ever holding/rendering everything.
export const LOAD_MORE_PREFIX = 'load-more:';

export function toTreeNode(node: NodeSummary): TreeDataNode {
  return {
    key: String(node.nodeId),
    title: node.label,
    isLeaf: !node.hasChildren,
  };
}

export function encodeLoadMoreKey(parentKey: Key, nextOffset: number): string {
  return `${LOAD_MORE_PREFIX}${String(parentKey)}:${String(nextOffset)}`;
}

// A "Load more..." row encodes the parent it pages and the next offset to fetch in
// its own key. Returns those, or null if `key` isn't a load-more placeholder.
export function decodeLoadMoreKey(key: Key): { parentKey: string; offset: number } | null {
  if (typeof key !== 'string' || !key.startsWith(LOAD_MORE_PREFIX)) {
    return null;
  }
  const rest = key.slice(LOAD_MORE_PREFIX.length);
  const lastColon = rest.lastIndexOf(':');
  return { parentKey: rest.slice(0, lastColon), offset: Number(rest.slice(lastColon + 1)) };
}

export function loadMoreNode(parentKey: Key, nextOffset: number, remaining: number): TreeDataNode {
  return {
    key: encodeLoadMoreKey(parentKey, nextOffset),
    title: `Load more... (${remaining.toLocaleString()} remaining)`,
    isLeaf: true,
  };
}

// Returns a copy of `list` with the children of the node matching `key` replaced by
// `updater(existing)`. Pure: never mutates the input nodes, so React sees fresh
// references for the changed path and can re-render it.
export function withChildrenAt(
  list: TreeDataNode[],
  key: Key,
  updater: (children: TreeDataNode[] | undefined) => TreeDataNode[],
): TreeDataNode[] {
  return list.map((node) => {
    if (node.key === key) {
      return { ...node, children: updater(node.children) };
    }
    if (node.children) {
      return { ...node, children: withChildrenAt(node.children, key, updater) };
    }
    return node;
  });
}

export function isLoadMoreKey(key: Key): boolean {
  return typeof key === 'string' && key.startsWith(LOAD_MORE_PREFIX);
}

// Depth-first lookup of the node with the given key, or undefined if not loaded.
export function findNode(list: TreeDataNode[], key: Key): TreeDataNode | undefined {
  for (const node of list) {
    if (node.key === key) {
      return node;
    }
    if (node.children) {
      const found = findNode(node.children, key);
      if (found) {
        return found;
      }
    }
  }
  return undefined;
}

// The real (non-"Load more...") children of a node -- the rows that correspond to
// actual document nodes, in the order get_node_path indexes them.
export function visibleChildren(node: TreeDataNode | undefined): TreeDataNode[] {
  return (node?.children ?? []).filter((c) => !isLoadMoreKey(c.key));
}

// Whether a node still has an unfetched next page (a "Load more..." placeholder).
export function hasLoadMore(node: TreeDataNode | undefined): boolean {
  return (node?.children ?? []).some((c) => isLoadMoreKey(c.key));
}

// Splices a freshly fetched page of children onto the node `parentKey`, dropping any
// prior "Load more..." placeholder and appending a new one when more pages remain.
// Factored out of the component so the pagination-merge logic is unit-testable.
export function mergePage(
  existing: TreeDataNode[] | undefined,
  parentKey: Key,
  pageNodes: TreeDataNode[],
  loadedThrough: number,
  total: number,
  hasMore: boolean,
): TreeDataNode[] {
  const withoutPlaceholder = (existing ?? []).filter(
    (n) => typeof n.key !== 'string' || !n.key.startsWith(LOAD_MORE_PREFIX),
  );
  const next = [...withoutPlaceholder, ...pageNodes];
  if (hasMore) {
    next.push(loadMoreNode(parentKey, loadedThrough, total - loadedThrough));
  }
  return next;
}
