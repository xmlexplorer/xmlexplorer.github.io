import type { TreeDataNode } from 'antd';
import { describe, expect, it } from 'vitest';
import {
  LOAD_MORE_PREFIX,
  decodeLoadMoreKey,
  encodeLoadMoreKey,
  loadMoreNode,
  mergePage,
  toTreeNode,
  withChildrenAt,
} from '../lib/treeData';

describe('toTreeNode', () => {
  it('maps a summary to a tree node, stringifying the id and inverting hasChildren to isLeaf', () => {
    expect(toTreeNode({ nodeId: 5, nodeType: 'element', label: '<book>', hasChildren: true })).toEqual({
      key: '5',
      title: '<book>',
      isLeaf: false,
    });
    expect(toTreeNode({ nodeId: 6, nodeType: 'element', label: '<cover/>', hasChildren: false }).isLeaf).toBe(
      true,
    );
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
