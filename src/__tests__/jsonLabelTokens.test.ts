import { describe, expect, it } from 'vitest';
import { jsonRowTokens, type JsonRowInfo } from '../lib/jsonLabelTokens';

const text = (tokens: { text: string }[]) => tokens.map((t) => t.text).join('');

const member = (key: string, value: string | null, childCount: number | null = null): JsonRowInfo => ({
  key,
  index: null,
  value,
  childCount,
});

const collapsed = { expanded: false, showIndex: false, countText: null };

describe('jsonRowTokens', () => {
  it('renders an object member scalar with key and typed value tokens', () => {
    const tokens = jsonRowTokens('string', member('name', '"Widget"'), collapsed);
    expect(text(tokens)).toBe('"name": "Widget"');
    expect(tokens.map((t) => t.kind)).toEqual(['key', 'punctuation', 'string']);
  });

  it('quotes keys as JSON strings', () => {
    expect(text(jsonRowTokens('number', member('say "hi"', '1'), collapsed))).toBe('"say \\"hi\\"": 1');
  });

  it('renders a collapsed container with an ellipsis and its count', () => {
    const tokens = jsonRowTokens('array', member('tags', null, 3), { ...collapsed, countText: '3 items' });
    expect(text(tokens)).toBe('"tags": [ … ]  3 items');
    expect(tokens[tokens.length - 1].kind).toBe('meta');
  });

  it('renders an expanded container as just its opening brace', () => {
    const tokens = jsonRowTokens('object', member('dims', null, 2), { ...collapsed, expanded: true, countText: '2 keys' });
    expect(text(tokens)).toBe('"dims": {');
  });

  it('renders empty containers as {} / []', () => {
    expect(text(jsonRowTokens('object', member('a', null, 0), collapsed))).toBe('"a": {}');
    expect(text(jsonRowTokens('array', member('b', null, 0), collapsed))).toBe('"b": []');
  });

  it('prefixes array items with their index only when asked', () => {
    const item: JsonRowInfo = { key: null, index: 4, value: 'true', childCount: null };
    expect(text(jsonRowTokens('boolean', item, collapsed))).toBe('true');
    const tokens = jsonRowTokens('boolean', item, { ...collapsed, showIndex: true });
    expect(text(tokens)).toBe('4: true');
    expect(tokens[0].kind).toBe('meta');
  });
});
