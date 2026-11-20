import type { JsonNodeType, NodeType } from './tauri';

export type JsonTokenKind = 'key' | 'string' | 'number' | 'boolean' | 'null' | 'punctuation' | 'meta';

export interface JsonToken {
  text: string;
  kind: JsonTokenKind;
}

// The JSON-specific fields of a NodeSummary (see tauri.ts) a tree row needs.
export interface JsonRowInfo {
  key: string | null;
  index: number | null;
  value: string | null;
  childCount: number | null;
}

export interface JsonRowOptions {
  // An expanded container shows only its opening brace; its closing brace is a
  // separate row after its children. A collapsed one shows `{ … }` plus a count.
  expanded: boolean;
  // Prefix array items with a dim `0: ` index.
  showIndex: boolean;
  // Localized entry count for a collapsed container, e.g. "3 items".
  countText: string | null;
}

const JSON_NODE_TYPES: ReadonlySet<NodeType> = new Set<JsonNodeType>([
  'object',
  'array',
  'string',
  'number',
  'boolean',
  'null',
]);

export function isJsonNodeType(nodeType: NodeType): nodeType is JsonNodeType {
  return JSON_NODE_TYPES.has(nodeType);
}

export function bracketsOf(nodeType: JsonNodeType): [string, string] {
  return nodeType === 'array' ? ['[', ']'] : ['{', '}'];
}

// Builds a tree row for a JSON node, e.g.
//   "name": "Widget"
//   "tags": [ … ] 3 items        (collapsed)
//   "tags": [                    (expanded; `]` is its own row)
//   0: { … } 5 keys              (array item, with showIndex)
export function jsonRowTokens(nodeType: JsonNodeType, info: JsonRowInfo, options: JsonRowOptions): JsonToken[] {
  const tokens: JsonToken[] = [];
  if (options.showIndex && info.index !== null) {
    tokens.push({ text: `${info.index}: `, kind: 'meta' });
  }
  if (info.key !== null) {
    tokens.push({ text: JSON.stringify(info.key), kind: 'key' });
    tokens.push({ text: ': ', kind: 'punctuation' });
  }

  if (nodeType === 'object' || nodeType === 'array') {
    const [open, close] = bracketsOf(nodeType);
    if (!info.childCount) {
      tokens.push({ text: `${open}${close}`, kind: 'punctuation' });
    } else if (options.expanded) {
      tokens.push({ text: open, kind: 'punctuation' });
    } else {
      tokens.push({ text: `${open} … ${close}`, kind: 'punctuation' });
      if (options.countText) {
        tokens.push({ text: `  ${options.countText}`, kind: 'meta' });
      }
    }
    return tokens;
  }

  tokens.push({ text: info.value ?? 'null', kind: nodeType });
  return tokens;
}
