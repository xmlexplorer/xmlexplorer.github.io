import type { TreeDataNode } from 'antd';
import type { Key } from 'react';
import type { JsonRowInfo } from './jsonLabelTokens';
import type { NodeSummary, NodeType } from './tauri';

// Some real documents have nodes with millions of direct children (a flat list of
// sibling records). get_children already returns those in bounded pages rather than
// all at once -- this is the UI-side half of that: a clickable placeholder node that
// fetches and splices in the next page, instead of ever holding/rendering everything.
export const LOAD_MORE_PREFIX = 'load-more:';

// JSON containers get a closing-brace row (`}` / `]`) after their last child, so
// an expanded object reads like the JSON it came from. Like "Load more...", it's
// a UI-only row, not a document node: it can't be selected and doesn't count as
// a child position.
export const CLOSE_PREFIX = 'close:';

// TreeDataNode plus the source node's type, so titleRender can syntax-highlight
// the label (tag vs attribute vs comment, etc.) without re-deriving it from the
// label string's shape.
export interface XmlTreeDataNode extends TreeDataNode {
  nodeType?: NodeType;
  // Present for JSON nodes: what the row renderer needs to draw it JSON-style.
  json?: JsonRowInfo;
  children?: XmlTreeDataNode[];
}

export function toTreeNode(node: NodeSummary): XmlTreeDataNode {
  const treeNode: XmlTreeDataNode = {
    key: String(node.nodeId),
    title: node.label,
    isLeaf: !node.hasChildren,
    nodeType: node.nodeType,
  };
  if (node.key !== undefined) {
    treeNode.json = {
      key: node.key ?? null,
      index: node.index ?? null,
      value: node.value,
      childCount: node.childCount ?? null,
    };
  }
  return treeNode;
}

export function closeNode(parentKey: Key, bracket: string): TreeDataNode {
  return {
    key: `${CLOSE_PREFIX}${String(parentKey)}`,
    title: bracket,
    isLeaf: true,
    selectable: false,
  };
}

export function isCloseKey(key: Key): boolean {
  return typeof key === 'string' && key.startsWith(CLOSE_PREFIX);
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

// Minimal shape of i18next's `t` that this module needs. `options` is required (every
// call here passes interpolation values) so i18next's `TFunction` stays assignable to it.
export type Translate = (key: string, options: Record<string, unknown>) => string;

// `t` is i18next's translate function, passed in (rather than imported) so this
// module stays free of any dependency on the app's i18n setup and is unit-testable
// with a plain stub.
export function loadMoreNode(
  parentKey: Key,
  nextOffset: number,
  remaining: number,
  t: Translate,
): TreeDataNode {
  return {
    key: encodeLoadMoreKey(parentKey, nextOffset),
    title: t('tree.load_more', { remaining }),
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

// UI-only rows ("Load more...", closing braces) rather than document nodes.
export function isPlaceholderKey(key: Key): boolean {
  return isLoadMoreKey(key) || isCloseKey(key);
}

// The real (non-placeholder) children of a node -- the rows that correspond to
// actual document nodes, in the order get_node_path indexes them.
export function visibleChildren(node: TreeDataNode | undefined): TreeDataNode[] {
  return (node?.children ?? []).filter((c) => !isPlaceholderKey(c.key));
}

// Whether a node still has an unfetched next page (a "Load more..." placeholder).
export function hasLoadMore(node: TreeDataNode | undefined): boolean {
  return (node?.children ?? []).some((c) => isLoadMoreKey(c.key));
}

// Splices a freshly fetched page of children onto the node `parentKey`, dropping any
// prior placeholder rows and appending a new "Load more..." when more pages remain,
// or else the closing-brace row `closer`, if given (JSON containers).
// Factored out of the component so the pagination-merge logic is unit-testable.
export function mergePage(
  existing: TreeDataNode[] | undefined,
  parentKey: Key,
  pageNodes: TreeDataNode[],
  loadedThrough: number,
  total: number,
  hasMore: boolean,
  t: Translate,
  closer?: TreeDataNode,
): TreeDataNode[] {
  const withoutPlaceholder = (existing ?? []).filter((n) => !isPlaceholderKey(n.key));
  const next = [...withoutPlaceholder, ...pageNodes];
  if (hasMore) {
    next.push(loadMoreNode(parentKey, loadedThrough, total - loadedThrough, t));
  } else if (closer) {
    next.push(closer);
  }
  return next;
}
