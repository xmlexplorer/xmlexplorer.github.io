import { CaretDownFilled, CopyOutlined, LoadingOutlined } from '@ant-design/icons';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { Dropdown, Spin, message, theme, Tree, type TreeDataNode } from 'antd';
import type { ComponentRef, Key } from 'react';
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { paintFrame } from '../lib/paintFrame';
import { getChildren, getFormattedOuterXml, getNodePath, type NodeSummary } from '../lib/tauri';
import {
  decodeLoadMoreKey,
  findNode,
  hasLoadMore,
  mergePage,
  toTreeNode,
  visibleChildren,
  withChildrenAt,
} from '../lib/treeData';
import './XmlTree.css';

export interface XmlTreeHandle {
  // Loads/expands the tree down to the given node and selects + scrolls to it.
  reveal: (nodeId: number) => Promise<void>;
}

interface XmlTreeProps {
  docId: number;
  root: NodeSummary;
  height: number;
  // The viewport width. scrollWidth is floored to this so rc-virtual-list's
  // horizontal-offset clamp never goes negative (which would shove every row to
  // the right) when the widest loaded row is narrower than the panel.
  width: number;
  // Notifies the parent when a real node (not a "Load more..." row) is selected,
  // so XPath can be evaluated relative to it. Null when selection is cleared.
  onSelectNode?: (node: { nodeId: number; label: string } | null) => void;
}

// Cap on pages fetched per level while revealing, so a match buried under a huge
// sibling list can't trigger thousands of sequential fetches.
const REVEAL_MAX_PAGES_PER_LEVEL = 40;

// Telling antd's virtual Tree an explicit scrollWidth is what makes it own the
// horizontal scroll: only then does rc-virtual-list translate trackpad/shift+wheel
// into horizontal motion (otherwise it eats the wheel for vertical scroll and you
// can only drag the bar) and render its themed scrollbar (--rc-virtual-list-
// scrollbar-bg) instead of a bare, light native one. The width has to be computed
// because antd can't measure rows it hasn't virtualized.
const TREE_FONT_PX = 14; // antd's default tree font size
const INDENT_PX = 24; // antd's per-level indent unit
const ROW_CHROME_PX = 48; // switcher + padding + a little trailing slack

let measureCtx: CanvasRenderingContext2D | null | undefined;
function measureMonospace(text: string): number {
  if (measureCtx === undefined) {
    measureCtx = document.createElement('canvas').getContext('2d');
    if (measureCtx) {
      measureCtx.font = `${TREE_FONT_PX}px monospace`;
    }
  }
  // Fallback if canvas is unavailable: a generous per-char estimate.
  return measureCtx ? measureCtx.measureText(text).width : text.length * TREE_FONT_PX * 0.7;
}

// The pixel width of the widest loaded row (indent + label), so the horizontal
// scrollbar spans exactly the content.
function widestRow(nodes: TreeDataNode[], depth: number): number {
  let max = 0;
  for (const node of nodes) {
    const label = typeof node.title === 'string' ? node.title : '';
    const width = ROW_CHROME_PX + depth * INDENT_PX + measureMonospace(label);
    if (width > max) {
      max = width;
    }
    if (node.children) {
      max = Math.max(max, widestRow(node.children, depth + 1));
    }
  }
  return max;
}

function labelOf(node: TreeDataNode | undefined): string {
  return typeof node?.title === 'string' ? node.title : '';
}

export const XmlTree = forwardRef<XmlTreeHandle, XmlTreeProps>(function XmlTree(
  { docId, root, height, width, onSelectNode },
  ref,
) {
  const { t } = useTranslation();
  const { token: { colorBorder, borderRadius } } = theme.useToken();

  const [treeData, setTreeDataState] = useState<TreeDataNode[]>([toTreeNode(root)]);
  // A ref mirror of treeData so reveal() can read the just-loaded children
  // synchronously between awaits, before React has re-rendered. All mutations go
  // through applyTreeUpdate, which reads/writes the ref and the state together.
  const treeDataRef = useRef<TreeDataNode[]>(treeData);
  const applyTreeUpdate = useCallback((updater: (prev: TreeDataNode[]) => TreeDataNode[]) => {
    const next = updater(treeDataRef.current);
    treeDataRef.current = next;
    setTreeDataState(next);
  }, []);

  // Floored to the viewport width: when the content is narrower than the panel,
  // a scrollWidth below the viewport makes rc-virtual-list clamp its horizontal
  // offset to a negative value and right-shift every row. At >= viewport width
  // the clamp is a no-op and no spurious horizontal scrollbar appears.
  const scrollWidth = useMemo(
    () => Math.max(Math.ceil(widestRow(treeData, 0)), Math.floor(width)),
    [treeData, width],
  );

  // Controlled so reveal() can expand/select programmatically; also mirrored in a
  // ref so reveal reads the current expansion without a stale closure.
  const [expandedKeys, setExpandedKeysState] = useState<Key[]>([]);
  const expandedKeysRef = useRef<Key[]>([]);
  const setExpandedKeys = useCallback((keys: Key[]) => {
    expandedKeysRef.current = keys;
    setExpandedKeysState(keys);
  }, []);
  const [selectedKeys, setSelectedKeys] = useState<Key[]>([]);

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

  const treeRef = useRef<ComponentRef<typeof Tree>>(null);

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

        applyTreeUpdate((prev) =>
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
    [docId, applyTreeUpdate],
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
    (keys: Key[], info: { node: TreeDataNode }) => {
      const loadMore = decodeLoadMoreKey(info.node.key);
      if (loadMore) {
        // "Load more..." rows aren't real nodes -- clicking one pages, it doesn't select.
        void loadPageInto(loadMore.parentKey, loadMore.offset);
        return;
      }
      setSelectedKeys(keys);
      if (keys.length === 0) {
        onSelectNode?.(null);
        return;
      }
      onSelectNode?.({ nodeId: Number(info.node.key), label: labelOf(info.node) });
    },
    [loadPageInto, onSelectNode],
  );

  // The node a right-click last landed on, so the context menu (positioned by
  // antd's own contextMenu trigger -- see the wrapping Dropdown below) knows
  // what to act on. Null hides the menu.
  const [contextMenuNode, setContextMenuNode] = useState<TreeDataNode | null>(null);

  const onRightClick = useCallback(
    ({ event, node }: { event: React.MouseEvent; node: TreeDataNode }) => {
      if (decodeLoadMoreKey(node.key)) {
        // "Load more..." rows aren't real nodes -- nothing to copy, so stop the
        // event reaching the wrapping Dropdown's contextMenu trigger rather than
        // popping open a menu with nothing to act on.
        event.stopPropagation();
        setContextMenuNode(null);
        return;
      }
      setSelectedKeys([node.key]);
      onSelectNode?.({ nodeId: Number(node.key), label: labelOf(node) });
      setContextMenuNode(node);
    },
    [onSelectNode],
  );

  const onCopyFormattedXml = useCallback(() => {
    const node = contextMenuNode;
    if (!node) {
      return;
    }
    void (async () => {
      try {
        const xml = await getFormattedOuterXml(docId, Number(node.key));
        await writeText(xml);
      } catch (err) {
        void message.error(t('tree.copy_failed', { error: String(err) }));
      }
    })();
  }, [contextMenuNode, docId, t]);

  const contextMenuItems = useMemo(
    () => [
      {
        key: 'copy-formatted-xml',
        icon: <CopyOutlined />,
        label: t('tree.copy_formatted_xml'),
        onClick: onCopyFormattedXml,
      },
    ],
    [t, onCopyFormattedXml],
  );

  // Walk get_node_path's child-index path from the root, lazily loading (and
  // paging, up to a cap) each level so the target row exists, then expand the
  // ancestors and select + scroll to it.
  const reveal = useCallback(
    async (nodeId: number) => {
      const path = await getNodePath(docId, nodeId);
      let currentKey: Key = String(root.nodeId);
      const expand = new Set<Key>(expandedKeysRef.current);

      for (const idx of path) {
        let node = findNode(treeDataRef.current, currentKey);
        if (!node?.children) {
          await loadPageInto(currentKey, 0);
          node = findNode(treeDataRef.current, currentKey);
        }
        let guard = 0;
        while (
          visibleChildren(node).length <= idx &&
          hasLoadMore(node) &&
          guard < REVEAL_MAX_PAGES_PER_LEVEL
        ) {
          await loadPageInto(currentKey, visibleChildren(node).length);
          node = findNode(treeDataRef.current, currentKey);
          guard += 1;
        }
        const child = visibleChildren(node)[idx];
        if (!child) {
          // Couldn't reach it (out of range, or beyond the per-level page cap).
          return;
        }
        expand.add(currentKey);
        currentKey = child.key;
      }

      setExpandedKeys([...expand]);
      setSelectedKeys([currentKey]);
      onSelectNode?.({
        nodeId: Number(currentKey),
        label: labelOf(findNode(treeDataRef.current, currentKey)),
      });
      // Let the newly expanded rows render before scrolling to the target.
      await paintFrame();
      treeRef.current?.scrollTo?.({ key: currentKey });
    },
    [docId, root.nodeId, loadPageInto, setExpandedKeys, onSelectNode],
  );

  useImperativeHandle(ref, () => ({ reveal }), [reveal]);

  return (
    // The fixed-height wrapper + .xml-tree-fill CSS forces antd's virtual scroll
    // viewport to fill the available area (instead of collapsing to the expanded
    // nodes' height), so the horizontal scrollbar stays pinned at the bottom.
    <div className="xml-tree-fill" style={{ height, borderWidth: 1, borderStyle: 'solid', borderColor: colorBorder, borderRadius }}>
      {/* trigger=['contextMenu'] gives antd's own alignPoint positioning (menu
          follows the cursor) and auto-close-on-outside-click for free; we only
          need to track which node the right-click landed on (onRightClick above). */}
      <Dropdown trigger={['contextMenu']} menu={{ items: contextMenuItems }}>
        <Tree
          ref={treeRef}
          // blockNode stretches each row to the full width (align-items: stretch)
          // instead of shrinking to its own content, so short rows like a lone
          // <catalog> root fill the panel rather than sitting in a narrow box.
          blockNode
          treeData={treeData}
          loadData={onLoadData}
          onSelect={onSelect}
          onRightClick={onRightClick}
          expandedKeys={expandedKeys}
          onExpand={setExpandedKeys}
          selectedKeys={selectedKeys}
          height={height}
          scrollWidth={scrollWidth}
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
      </Dropdown>
    </div>
  );
});
