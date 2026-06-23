import { CaretDownFilled, LoadingOutlined } from '@ant-design/icons';
import { Spin, Tree, type TreeDataNode } from 'antd';
import type { Key } from 'react';
import { useCallback, useRef, useState } from 'react';
import { paintFrame } from '../lib/paintFrame';
import { getChildren, type NodeSummary } from '../lib/tauri';
import { decodeLoadMoreKey, mergePage, toTreeNode, withChildrenAt } from '../lib/treeData';

interface XmlTreeProps {
  docId: number;
  root: NodeSummary;
  height: number;
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
    // antd's built-in switcher-arrow loading icon (which would otherwise cover the
    // loadData/expand case for free) doesn't render visibly in this antd/webview
    // combination, so we track loading ourselves for every case instead -- this is
    // also the only indicator at all for "Load more..." rows, which are plain
    // leaves clicked via onSelect and have no switcher to begin with.
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
          withChildrenAt(prev, parentKey, (existing) =>
            mergePage(existing, parentKey, pageNodes, loadedThrough, page.total, page.hasMore),
          ),
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
      const loadMore = decodeLoadMoreKey(info.node.key);
      if (loadMore) {
        void loadPageInto(loadMore.parentKey, loadMore.offset);
      }
    },
    [loadPageInto],
  );

  return (
    <Tree
      treeData={treeData}
      loadData={onLoadData}
      onSelect={onSelect}
      height={height}
      // An expandable node's caret is swapped for a spinner while its children load.
      // antd only calls switcherIcon for non-leaf nodes, so "Load more..." leaf rows
      // never reach here -- they get a title spinner below instead.
      switcherIcon={(node) =>
        node.eventKey != null && loadingKeys.has(node.eventKey) ? (
          <LoadingOutlined />
        ) : (
          <CaretDownFilled />
        )
      }
      titleRender={(node) => {
        // "Load more..." rows have no switcher to spin, so show progress in their
        // title: they're loading when the parent they page (encoded in their key)
        // is the key being fetched.
        const loadMore = decodeLoadMoreKey(node.key);
        const isLoading = loadMore != null && loadingKeys.has(loadMore.parentKey);
        // node.title is always a string in our data, but antd types it as a
        // ReactNode-or-render-function; resolve it to a node rather than stringify.
        const title = typeof node.title === 'function' ? node.title(node) : node.title;
        return (
          <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            {title}
            {isLoading && <Spin size="small" />}
          </span>
        );
      }}
      style={{ fontFamily: 'monospace', whiteSpace: 'pre' }}
    />
  );
}
