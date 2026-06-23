import type { TreeDataNode } from 'antd';
import { describe, expect, it } from 'vitest';
import {
  LOAD_MORE_PREFIX,
  decodeLoadMoreKey,
  encodeLoadMoreKey,
  findNode,
  hasLoadMore,
  isLoadMoreKey,
  loadMoreNode,
  mergePage,
  toTreeNode,
  visibleChildren,
  withChildrenAt,
} from '../lib/treeData';

describe('toTreeNode', () => {
  it('maps a summary to a tree node, stringifying the id and inverting hasChildren to isLeaf', () => {
    expect(
      toTreeNode({ nodeId: 5, nodeType: 'element', label: '<book>', hasChildren: true, value: null }),
    ).toEqual({
      key: '5',
      title: '<book>',
      isLeaf: false,
    });
    expect(
      toTreeNode({ nodeId: 6, nodeType: 'element', label: '<cover/>', hasChildren: false, value: null })
        .isLeaf,
    ).toBe(true);
  });
});

describe('encode/decodeLoadMoreKey', () => {
  it('round-trips a parent key and offset', () => {
    const key = encodeLoadMoreKey('42', 500);
    expect(key.startsWith(LOAD_MORE_PREFIX)).toBe(true);
    expect(decodeLoadMoreKey(key)).toEqual({ parentKey: '42', offset: 500 });
  });

  it('returns null for a normal node key', () => {
    expect(decodeLoadMoreKey('42')).toBeNull();
  });

  it('returns null for a non-string key', () => {
    expect(decodeLoadMoreKey(42)).toBeNull();
  });

  it('splits on the last colon so the offset is parsed even if the parent key had one', () => {
    // Defensive: node keys are numeric ids today (no colon), but the decoder must not
    // mis-split if a parent key ever contains one -- the offset is always the last segment.
    expect(decodeLoadMoreKey(`${LOAD_MORE_PREFIX}a:b:250`)).toEqual({ parentKey: 'a:b', offset: 250 });
  });
});

describe('loadMoreNode', () => {
  it('builds a leaf placeholder with the remaining count in its title', () => {
    const node = loadMoreNode('42', 500, 1700);
    expect(node.isLeaf).toBe(true);
    expect(node.key).toBe(encodeLoadMoreKey('42', 500));
    expect(node.title).toBe('Load more... (1,700 remaining)');
  });
});

describe('withChildrenAt', () => {
  const tree: TreeDataNode[] = [
    { key: 'a', title: 'a', children: [{ key: 'a1', title: 'a1' }] },
    { key: 'b', title: 'b' },
  ];

  it('replaces the children of a nested matching node', () => {
    const next = withChildrenAt(tree, 'a', () => [{ key: 'a2', title: 'a2' }]);
    expect(next[0].children).toEqual([{ key: 'a2', title: 'a2' }]);
  });

  it('does not mutate the input tree', () => {
    const snapshot = structuredClone(tree);
    withChildrenAt(tree, 'a', () => [{ key: 'x', title: 'x' }]);
    expect(tree).toEqual(snapshot);
  });

  it('returns equivalent data and fresh node references along the changed path', () => {
    const next = withChildrenAt(tree, 'a', (existing) => existing ?? []);
    expect(next[0]).not.toBe(tree[0]); // changed node is a new object
    expect(next[1]).toBe(tree[1]); // untouched sibling keeps its reference
  });

  it('passes the existing children (or undefined for a never-loaded node) to the updater', () => {
    const seen: Array<TreeDataNode[] | undefined> = [];
    withChildrenAt(tree, 'b', (existing) => {
      seen.push(existing);
      return [];
    });
    expect(seen).toEqual([undefined]);
  });
});

describe('tree-walking helpers (used by reveal)', () => {
  const tree: TreeDataNode[] = [
    {
      key: '0',
      title: 'root',
      children: [
        { key: '1', title: 'a' },
        { key: '2', title: 'b', children: [{ key: '3', title: 'b1' }] },
        loadMoreNode('0', 2, 5),
      ],
    },
  ];

  it('isLoadMoreKey distinguishes placeholders from real keys', () => {
    expect(isLoadMoreKey(encodeLoadMoreKey('0', 2))).toBe(true);
    expect(isLoadMoreKey('2')).toBe(false);
    expect(isLoadMoreKey(2)).toBe(false);
  });

  it('findNode locates a deeply nested node and returns undefined when absent', () => {
    expect(findNode(tree, '3')?.title).toBe('b1');
    expect(findNode(tree, 'nope')).toBeUndefined();
  });

  it('visibleChildren excludes the Load more placeholder', () => {
    const root = findNode(tree, '0');
    expect(visibleChildren(root).map((n) => n.key)).toEqual(['1', '2']);
    expect(visibleChildren(findNode(tree, '1'))).toEqual([]); // no children -> empty
  });

  it('hasLoadMore reflects whether a next page remains', () => {
    expect(hasLoadMore(findNode(tree, '0'))).toBe(true);
    expect(hasLoadMore(findNode(tree, '2'))).toBe(false);
  });
});

describe('mergePage', () => {
  const page = [
    { key: '1', title: 'one', isLeaf: true },
    { key: '2', title: 'two', isLeaf: true },
  ];

  it('appends the first page and adds a Load more placeholder when more remain', () => {
    const merged = mergePage(undefined, '0', page, 2, 10, true);
    expect(merged.slice(0, 2)).toEqual(page);
    const last = merged[merged.length - 1];
    expect(decodeLoadMoreKey(last.key)).toEqual({ parentKey: '0', offset: 2 });
    expect(last.title).toBe('Load more... (8 remaining)');
  });

  it('omits the placeholder on the final page', () => {
    const merged = mergePage(undefined, '0', page, 2, 2, false);
    expect(merged).toEqual(page);
    expect(merged.some((n) => typeof n.key === 'string' && n.key.startsWith(LOAD_MORE_PREFIX))).toBe(false);
  });

  it('drops the prior Load more placeholder before appending the next page', () => {
    const existing = [
      { key: '1', title: 'one', isLeaf: true },
      loadMoreNode('0', 1, 9),
    ];
    const merged = mergePage(existing, '0', [{ key: '2', title: 'two', isLeaf: true }], 2, 10, true);
    const placeholders = merged.filter(
      (n) => typeof n.key === 'string' && n.key.startsWith(LOAD_MORE_PREFIX),
    );
    expect(placeholders).toHaveLength(1); // exactly one, the fresh one
    expect(merged.map((n) => n.key)).toEqual(['1', '2', encodeLoadMoreKey('0', 2)]);
  });
});
