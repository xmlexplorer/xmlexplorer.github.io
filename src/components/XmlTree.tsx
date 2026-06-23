import { Spin, Tree, type TreeDataNode } from 'antd';
import type { Key } from 'react';
import { useCallback, useRef, useState } from 'react';
import { paintFrame } from '../lib/paintFrame';
import { getChildren, type NodeSummary } from '../lib/tauri';

interface XmlTreeProps {
  docId: number;
  root: NodeSummary;
  height: number;
}

// Some real documents have nodes with millions of direct children (a flat list of
// sibling records). get_children already returns those in bounded pages rather than
// all at once -- this is the UI-side half of that: a clickable placeholder node that
// fetches and splices in the next page, instead of ever holding/rendering everything.
const LOAD_MORE_PREFIX = 'load-more:';

function toTreeNode(node: NodeSummary): TreeDataNode {
  return {
    key: String(node.nodeId),
    title: node.label,
    isLeaf: !node.hasChildren,
  };
}

function loadMoreNode(parentKey: Key, nextOffset: number, remaining: number): TreeDataNode {
  return {
    key: `${LOAD_MORE_PREFIX}${String(parentKey)}:${String(nextOffset)}`,
    title: `Load more... (${remaining.toLocaleString()} remaining)`,
    isLeaf: true,
  };
}

function withChildrenAt(
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

export function XmlTree({ docId, root, height }: XmlTreeProps) {
  const [treeData, setTreeData] = useState<TreeDataNode[]>([toTreeNode(root)]);
  // Tracked separately from treeData (rather than baked into each node's title) so a
  // node already past, say, half a second of loading -- the large fixture's root takes
  // a real, perceptible moment the first time it's expanded -- visibly shows it's still
  // working instead of just sitting there looking unresponsive.
  const [loadingKeys, setLoadingKeys] = useState<ReadonlySet<Key>>(new Set());
  // A ref (checked synchronously) rather than just the loadingKeys state: guards against
  // a second trigger for the same node -- e.g. an impatient repeat click on "Load more"
  // before the first request's state update lands -- firing an overlapping duplicate
  // fetch. That's exactly what produced "two children with the same key" React warnings
  // (and actual duplicated tree rows) during testing.
  const loadingRef = useRef<Set<Key>>(new Set());

  const loadPageInto = useCallback(
    async (parentKey: Key, offset: number) => {
      if (loadingRef.current.has(parentKey)) {
        return;
      }
      loadingRef.current.add(parentKey);
      setLoadingKeys((prev) => new Set(prev).add(parentKey));
      await paintFrame();
      try {
        const nodeId = Number(parentKey);
        const page = await getChildren(docId, nodeId, offset);
        const pageNodes = page.items.map(toTreeNode);
        const loadedThrough = page.offset + page.items.length;

        setTreeData((prev) =>
          withChildrenAt(prev, parentKey, (existing) => {
            const withoutPlaceholder = (existing ?? []).filter(
              (n) => typeof n.key !== 'string' || !n.key.startsWith(LOAD_MORE_PREFIX),
            );
            const next = [...withoutPlaceholder, ...pageNodes];
            if (page.hasMore) {
              next.push(loadMoreNode(parentKey, loadedThrough, page.total - loadedThrough));
            }
            return next;
          }),
        );
      } finally {
        loadingRef.current.delete(parentKey);
        setLoadingKeys((prev) => {
          const next = new Set(prev);
          next.delete(parentKey);
          return next;
        });
      }
    },
    [docId],
  );

  // Mirrors XPathNavigatorTreeView's on-expand lazy loading: a node's first page of
  // children is only fetched the first time it's expanded.
  const onLoadData = useCallback(
    async (node: TreeDataNode) => {
      if (node.children) {
        return;
      }
      await loadPageInto(node.key, 0);
    },
    [loadPageInto],
  );

  const onSelect = useCallback(
    (_selectedKeys: Key[], info: { node: TreeDataNode }) => {
      const key = info.node.key;
      if (typeof key !== 'string' || !key.startsWith(LOAD_MORE_PREFIX)) {
        return;
      }
      const rest = key.slice(LOAD_MORE_PREFIX.length);
      const lastColon = rest.lastIndexOf(':');
      const parentKey = rest.slice(0, lastColon);
      const offset = Number(rest.slice(lastColon + 1));
      void loadPageInto(parentKey, offset);
    },
    [loadPageInto],
  );

  return (
    <Tree
      treeData={treeData}
      loadData={onLoadData}
      onSelect={onSelect}
      height={height}
      showLine
      titleRender={(node) => (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          {String(node.title)}
          {loadingKeys.has(node.key) && <Spin size="small" />}
        </span>
      )}
      style={{ fontFamily: 'monospace', whiteSpace: 'pre' }}
    />
  );
}
