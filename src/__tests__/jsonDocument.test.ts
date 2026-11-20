import { describe, expect, it } from 'vitest';
import { JsonDocument, normalizedPath } from '../lib/jsonDocument';
import { looksLikeJson } from '../lib/webEngine';

const SAMPLE = JSON.stringify({
  store: {
    book: [
      { title: 'Sayings', price: 8.95, tags: [] },
      { title: 'Sword', price: 12.99, tags: ['fiction', 'classic'] },
    ],
    open: true,
    owner: null,
  },
  meta: {},
});

describe('JsonDocument tree', () => {
  it('summarizes the root container', () => {
    const doc = JsonDocument.parse(SAMPLE);
    expect(doc.rootSummary()).toEqual({
      nodeId: 0,
      nodeType: 'object',
      label: '{…}',
      hasChildren: true,
      value: null,
      key: null,
      index: null,
      childCount: 2,
    });
  });

  it('lists object members in order with JSON-style labels', () => {
    const doc = JsonDocument.parse(SAMPLE);
    const top = doc.getChildren(0);
    expect(top.items.map((i) => i.label)).toEqual(['"store": {…}', '"meta": {}']);
    expect(top.items[1].hasChildren).toBe(false);

    const store = doc.getChildren(top.items[0].nodeId);
    expect(store.items.map((i) => [i.nodeType, i.label, i.value])).toEqual([
      ['array', '"book": […]', null],
      ['boolean', '"open": true', 'true'],
      ['null', '"owner": null', 'null'],
    ]);
  });

  it('gives array items an index and no key', () => {
    const doc = JsonDocument.parse('[10, "x", [1]]');
    const items = doc.getChildren(0).items;
    expect(items.map((i) => [i.key, i.index, i.label])).toEqual([
      [null, 0, '10'],
      [null, 1, '"x"'],
      [null, 2, '[…]'],
    ]);
    expect(items[2].childCount).toBe(1);
  });

  it('re-expanding returns the same ids', () => {
    const doc = JsonDocument.parse(SAMPLE);
    expect(doc.getChildren(0).items.map((i) => i.nodeId)).toEqual(doc.getChildren(0).items.map((i) => i.nodeId));
  });

  it('pages large arrays 500 at a time', () => {
    const doc = JsonDocument.parse(JSON.stringify(Array.from({ length: 1200 }, (_, i) => i)));
    const first = doc.getChildren(0);
    expect([first.items.length, first.total, first.hasMore]).toEqual([500, 1200, true]);
    const last = doc.getChildren(0, 1000);
    expect([last.items.length, last.hasMore, last.items[0].label]).toEqual([200, false, '1000']);
  });

  it('opens a bare scalar document', () => {
    const doc = JsonDocument.parse(' "hello" ');
    expect(doc.rootSummary()).toMatchObject({ nodeType: 'string', label: '"hello"', hasChildren: false });
  });

  it('caps long string previews', () => {
    const doc = JsonDocument.parse(JSON.stringify({ s: 'a'.repeat(500) }));
    const value = doc.getChildren(0).items[0].value ?? '';
    expect(value).toBe(`"${'a'.repeat(200)}…"`);
  });

  it('rejects invalid JSON', () => {
    expect(() => JsonDocument.parse('{"a": }')).toThrow(SyntaxError);
  });
});

describe('JsonDocument number fidelity', () => {
  it('shows numbers exactly as written when JS would print them differently', () => {
    const doc = JsonDocument.parse('{"id": 12345678901234567890, "f": 1.50, "e": 1e3, "n": 42}');
    expect(doc.getChildren(0).items.map((i) => i.value)).toEqual(['12345678901234567890', '1.50', '1e3', '42']);
  });

  it('keeps original number text in formatted output', () => {
    const doc = JsonDocument.parse('[12345678901234567890, 2.0]');
    expect(doc.getFormatted(0)).toBe('[\n  12345678901234567890,\n  2.0\n]');
  });

  it('handles a bare top-level number', () => {
    expect(JsonDocument.parse('1.0').rootSummary().label).toBe('1.0');
  });
});

describe('JsonDocument paths', () => {
  it('maps tree nodes to child positions', () => {
    const doc = JsonDocument.parse(SAMPLE);
    const store = doc.getChildren(0).items[0];
    const book = doc.getChildren(store.nodeId).items[0];
    const second = doc.getChildren(book.nodeId).items[1];
    const tags = doc.getChildren(second.nodeId).items[2];
    expect(doc.getNodePath(tags.nodeId)).toEqual([0, 0, 1, 2]);
    expect(doc.getNodePath(0)).toEqual([]);
  });

  it('maps query results to child positions', () => {
    const doc = JsonDocument.parse(SAMPLE);
    const page = doc.evaluateQuery('$.store.book[1].tags[1]');
    expect(doc.getNodePath(page.items[0].nodeId)).toEqual([0, 0, 1, 2, 1]);
    expect(doc.getNodePath(doc.evaluateQuery('$.meta').items[0].nodeId)).toEqual([1]);
  });

  it('builds RFC 9535 normalized paths', () => {
    expect(normalizedPath([])).toBe('$');
    expect(normalizedPath(['a', 0, "it's", 'back\\slash', 'tab\t'])).toBe(
      "$['a'][0]['it\\'s']['back\\\\slash']['tab\\t']",
    );
  });
});

describe('JsonDocument JSONPath', () => {
  it('returns matches with labels and normalized paths', () => {
    const doc = JsonDocument.parse(SAMPLE);
    const page = doc.evaluateQuery('$.store.book[?@.price < 10].title');
    expect(page.total).toBe(1);
    expect(page.items[0]).toMatchObject({ label: '"title": "Sayings"', path: "$['store']['book'][0]['title']" });
  });

  it('labels matched array items without a key', () => {
    const doc = JsonDocument.parse(SAMPLE);
    const page = doc.evaluateQuery('$..tags[*]');
    expect(page.items.map((i) => [i.label, i.path])).toEqual([
      ['"fiction"', "$['store']['book'][1]['tags'][0]"],
      ['"classic"', "$['store']['book'][1]['tags'][1]"],
    ]);
  });

  it('pages large result sets and reuses ids for the cached query', () => {
    const doc = JsonDocument.parse(JSON.stringify({ a: Array.from({ length: 700 }, (_, i) => ({ v: i })) }));
    const first = doc.evaluateQuery('$.a[*].v');
    expect([first.items.length, first.total, first.hasMore]).toEqual([500, 700, true]);
    const second = doc.evaluateQuery('$.a[*].v', 500);
    expect([second.items.length, second.hasMore, second.items[0].label]).toEqual([200, false, '"v": 500']);
    expect(doc.evaluateQuery('$.a[*].v').items[0].nodeId).toBe(first.items[0].nodeId);
  });

  it('reports invalid expressions as errors', () => {
    const doc = JsonDocument.parse(SAMPLE);
    expect(() => doc.evaluateQuery('$.store[?@.price >')).toThrow();
    expect(() => doc.evaluateQuery('store.book')).toThrow();
  });

  it('points at the error position in the query', () => {
    const doc = JsonDocument.parse(SAMPLE);
    expect(() => doc.evaluateQuery('$.a[?foo(@)]')).toThrow(
      "unknown function 'foo'\n1 | $.a[?foo(@)]\n  |      ^^^ unknown function 'foo'",
    );
  });

  it('handles descendant queries deeper than json-p3’s default 100-level limit', () => {
    let text = '1';
    for (let i = 0; i < 150; i += 1) {
      text = `{"x": ${text}}`;
    }
    expect(JsonDocument.parse(text).evaluateQuery('$..x').total).toBe(150);
  });
});

describe('JsonDocument formatting', () => {
  it('pretty-prints a subtree as valid JSON, without its member key', () => {
    const doc = JsonDocument.parse(SAMPLE);
    const store = doc.getChildren(0).items[0];
    const book = doc.getChildren(store.nodeId).items[0];
    const first = doc.getChildren(book.nodeId).items[0];
    expect(doc.getFormatted(first.nodeId)).toBe('{\n  "title": "Sayings",\n  "price": 8.95,\n  "tags": []\n}');
    expect(JSON.parse(doc.getFormatted(0))).toEqual(JSON.parse(SAMPLE));
  });
});

describe('looksLikeJson', () => {
  it('trusts a .json extension', () => {
    expect(looksLikeJson('data.JSON', '42')).toBe(true);
  });

  it('sniffs content starting with { or [, ignoring whitespace and a BOM', () => {
    expect(looksLikeJson('data.txt', '﻿\n  {"a": 1}')).toBe(true);
    expect(looksLikeJson('response', '[1]')).toBe(true);
  });

  it('leaves XML (any extension) to the XML parser', () => {
    expect(looksLikeJson('feed.rss', '<?xml version="1.0"?><rss/>')).toBe(false);
    expect(looksLikeJson('notes.json.xml', '<a/>')).toBe(false);
  });
});
