// A parsed JSON document behind the same tree/query contract the XML engines
// serve (lazy node ids, paged children, child-index paths for reveal, paged
// query results), so the React tree and query panel work unchanged. Pure logic --
// no DOM -- so it's unit-testable in node and reusable by any backend.
//
// Queries are JSONPath (RFC 9535, via json-p3). Unlike XPath they always run
// against the document root: JSONPath has no relative paths, so evaluating `$`
// against whatever node happens to be selected would just make pasted queries
// silently return nothing.
import {
  DetailedJSONPathError,
  JSONPathEnvironment,
  JSONPathError,
  type JSONPathNode,
  type JSONValue,
} from 'json-p3';
import type { JsonNodeType, NodeSummary, NodeSummaryPage } from './tauri';

// Kept identical to the XML engines' limits (see webEngine.ts / native tree.rs).
const VALUE_PREVIEW_MAX = 200;
const PAGE_SIZE = 500;

type JsonObject = { [key: string]: JSONValue };
type JsonContainer = JSONValue[] | JsonObject;
type PathStep = string | number;

// json-p3's default caps descendant (`..`) recursion at 100 levels; real JSON
// can nest deeper than that, and a query error there would look like a bug.
const JSONPATH_ENV = new JSONPathEnvironment({ maxRecursionDepth: 1000 });

interface ArenaNode {
  value: JSONValue;
  // The object/array holding this value (null for the root) and this value's
  // member name or index within it.
  container: JsonContainer | null;
  step: PathStep | null;
  // Tree-expanded nodes link to their parent's id; query results instead carry
  // their full location from json-p3. Either is enough to rebuild the path.
  parentId: number | null;
  path: PathStep[] | null;
}

interface QueryCache {
  expression: string;
  matches: JSONPathNode[];
  // Arena ids assigned lazily, per page -- mirrors the XPath result cache.
  ids: (number | null)[];
}

// Number literals whose JS double doesn't print back the same text: 16+ digits
// (beyond double precision -- e.g. 64-bit IDs), exponents, and trailing
// fractional zeros. Only when the text contains one of these do we pay for the
// slower source-capturing parse; false positives (inside strings) just cost time.
const LOSSY_NUMBER_RE = /\d{16}|\d[eE]|\.\d*0(?!\d)/;

interface ReviverContext {
  source?: string;
}

interface ParsedJson {
  value: JSONValue;
  // container -> member name/index -> the number's original source text, for
  // numbers whose JS value would display differently. Null when not needed.
  rawNumbers: WeakMap<object, Map<string, string>> | null;
  rootRaw: string | null;
}

function parse(text: string): ParsedJson {
  if (!LOSSY_NUMBER_RE.test(text)) {
    return { value: JSON.parse(text) as JSONValue, rawNumbers: null, rootRaw: null };
  }
  const rawNumbers = new WeakMap<object, Map<string, string>>();
  // The third reviver argument (JSON.parse source text access) is only present
  // in recent engines; where it's missing numbers simply display as JS prints them.
  const reviver = function (this: object, key: string, value: unknown, context?: ReviverContext) {
    const source = context?.source;
    if (typeof value === 'number' && source !== undefined && String(value) !== source) {
      let byKey = rawNumbers.get(this);
      if (!byKey) {
        byKey = new Map();
        rawNumbers.set(this, byKey);
      }
      byKey.set(key, source);
    }
    return value;
  };
  const value = JSON.parse(text, reviver as (this: unknown, key: string, value: unknown) => unknown) as JSONValue;
  // A bare top-level number's holder is an internal wrapper we never see again.
  const trimmed = text.trim();
  const rootRaw = typeof value === 'number' && String(value) !== trimmed ? trimmed : null;
  return { value, rawNumbers, rootRaw };
}

function isContainer(value: JSONValue): value is JsonContainer {
  return typeof value === 'object' && value !== null;
}

export function jsonNodeType(value: JSONValue): JsonNodeType {
  if (value === null || value === undefined) {
    return 'null';
  }
  if (Array.isArray(value)) {
    return 'array';
  }
  switch (typeof value) {
    case 'object':
      return 'object';
    case 'string':
      return 'string';
    case 'number':
      return 'number';
    default:
      return 'boolean';
  }
}

function childCount(value: JsonContainer): number {
  return Array.isArray(value) ? value.length : Object.keys(value).length;
}

// A JSON string literal capped at VALUE_PREVIEW_MAX characters, truncated before
// escaping so a multi-megabyte string isn't stringified just for a preview.
function stringPreview(value: string): string {
  const chars = Array.from(value);
  if (chars.length <= VALUE_PREVIEW_MAX) {
    return JSON.stringify(value);
  }
  return `${JSON.stringify(chars.slice(0, VALUE_PREVIEW_MAX).join('')).slice(0, -1)}…"`;
}

// RFC 9535 normalized path, e.g. $['store']['book'][0].
export function normalizedPath(path: readonly PathStep[]): string {
  let out = '$';
  for (const step of path) {
    out += typeof step === 'number' ? `[${step}]` : `[${normalizedName(step)}]`;
  }
  return out;
}

// Normalized-path member names use single quotes, escaping \ and ' and control
// characters (RFC 9535 section 2.7).
function normalizedName(name: string): string {
  let out = "'";
  for (const ch of name) {
    const code = ch.charCodeAt(0);
    if (ch === '\\' || ch === "'") {
      out += `\\${ch}`;
    } else if (ch === '\b') {
      out += '\\b';
    } else if (ch === '\f') {
      out += '\\f';
    } else if (ch === '\n') {
      out += '\\n';
    } else if (ch === '\r') {
      out += '\\r';
    } else if (ch === '\t') {
      out += '\\t';
    } else if (code < 0x20) {
      out += `\\u${code.toString(16).padStart(4, '0')}`;
    } else {
      out += ch;
    }
  }
  return `${out}'`;
}

// json-p3's detailed errors render as
//   syntax error: <message>
//     -> <query>:1:18
//     |
//   1 | <query>
//     |        ^ <message>
// Keep the message plus the source and caret lines (dropping the header,
// position, and spacer lines), for display in monospace.
export function describeQueryError(err: unknown): string {
  if (err instanceof DetailedJSONPathError) {
    const lines = err.render().split('\n');
    const position = lines.findIndex((line) => line.trimStart().startsWith('->'));
    return position < 0 ? err.message : [err.message, ...lines.slice(position + 2)].join('\n');
  }
  return err instanceof JSONPathError ? err.message : String(err);
}

export class JsonDocument {
  private readonly root: JSONValue;
  private readonly rawNumbers: WeakMap<object, Map<string, string>> | null;
  private readonly rootRaw: string | null;
  // Node id 0 is the document root, as in the XML engines.
  private readonly nodes: ArenaNode[];
  private readonly expanded = new Map<number, number[]>();
  // Lazily built member-name -> position maps, so revealing a query match inside
  // a huge object doesn't rescan its keys at every step.
  private readonly keyPositions = new WeakMap<object, Map<string, number>>();
  private queryCache: QueryCache | null = null;

  private constructor(parsed: ParsedJson) {
    this.root = parsed.value;
    this.rawNumbers = parsed.rawNumbers;
    this.rootRaw = parsed.rootRaw;
    this.nodes = [{ value: parsed.value, container: null, step: null, parentId: null, path: [] }];
  }

  // Throws a SyntaxError (from JSON.parse) when `text` isn't valid JSON.
  static parse(text: string): JsonDocument {
    return new JsonDocument(parse(text));
  }

  rootSummary(): NodeSummary {
    return this.summary(0);
  }

  getChildren(nodeId: number, offset = 0): NodeSummaryPage {
    let ids = this.expanded.get(nodeId);
    if (!ids) {
      const value = this.getNode(nodeId).value;
      ids = [];
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i += 1) {
          ids.push(this.push({ value: value[i], container: value, step: i, parentId: nodeId, path: null }));
        }
      } else if (isContainer(value)) {
        for (const key of Object.keys(value)) {
          ids.push(this.push({ value: value[key], container: value, step: key, parentId: nodeId, path: null }));
        }
      }
      this.expanded.set(nodeId, ids);
    }
    const total = ids.length;
    const items = ids.slice(offset, offset + PAGE_SIZE).map((id) => this.summary(id));
    return { items, offset, total, hasMore: offset + items.length < total };
  }

  // Child positions from the root down to nodeId, as the tree shows them.
  getNodePath(nodeId: number): number[] {
    const positions: number[] = [];
    let current = this.root;
    for (const step of this.pathOf(nodeId)) {
      if (typeof step === 'number') {
        positions.push(step);
        current = (current as JSONValue[])[step];
      } else {
        const obj = current as JsonObject;
        positions.push(this.keyPosition(obj, step));
        current = obj[step];
      }
    }
    return positions;
  }

  // Evaluates a JSONPath query against the document root. Matches are cached by
  // expression so paging doesn't re-run a (potentially document-wide) query.
  evaluateQuery(expression: string, offset = 0): NodeSummaryPage {
    if (this.queryCache?.expression !== expression) {
      let matches: JSONPathNode[];
      try {
        matches = JSONPATH_ENV.find(expression, this.root);
      } catch (err) {
        this.queryCache = null;
        throw new Error(describeQueryError(err));
      }
      this.queryCache = { expression, matches, ids: matches.map(() => null) };
    }
    const cache = this.queryCache;
    const total = cache.matches.length;
    const end = Math.min(offset + PAGE_SIZE, total);
    const items: NodeSummary[] = [];
    for (let i = offset; i < end; i += 1) {
      let id = cache.ids[i];
      const match = cache.matches[i];
      if (id === null) {
        const location = match.location;
        const parent = match.parentNode();
        id = this.push({
          value: match.value,
          container: parent && isContainer(parent.value) ? parent.value : null,
          step: location.length > 0 ? location[location.length - 1] : null,
          parentId: null,
          path: location,
        });
        cache.ids[i] = id;
      }
      items.push({ ...this.summary(id), path: match.normalizedPath() });
    }
    return { items, offset, total, hasMore: end < total };
  }

  // The node's value as pretty-printed (2-space) JSON. For an object member
  // that's just the value, not `"key": value`, so the copy is valid JSON.
  getFormatted(nodeId: number): string {
    const node = this.getNode(nodeId);
    return this.serialize(node.value, node.container, node.step, '');
  }

  private getNode(nodeId: number): ArenaNode {
    const node = this.nodes[nodeId];
    if (!node) {
      throw new Error(`node ${nodeId} not found`);
    }
    return node;
  }

  private push(node: ArenaNode): number {
    this.nodes.push(node);
    return this.nodes.length - 1;
  }

  private pathOf(nodeId: number): PathStep[] {
    const steps: PathStep[] = [];
    let node = this.getNode(nodeId);
    for (;;) {
      if (node.path) {
        return [...node.path, ...steps.reverse()];
      }
      if (node.step !== null) {
        steps.push(node.step);
      }
      if (node.parentId === null) {
        return steps.reverse();
      }
      node = this.getNode(node.parentId);
    }
  }

  private keyPosition(obj: JsonObject, key: string): number {
    let positions = this.keyPositions.get(obj);
    if (!positions) {
      positions = new Map(Object.keys(obj).map((k, i) => [k, i]));
      this.keyPositions.set(obj, positions);
    }
    const position = positions.get(key);
    if (position === undefined) {
      throw new Error(`member '${key}' not found`);
    }
    return position;
  }

  // The number's text as written in the file when JS would print it differently
  // (lost precision, exponent, trailing zeros); otherwise JS's own rendering.
  private numberText(value: number, container: JsonContainer | null, step: PathStep | null): string {
    const raw = container ? this.rawNumbers?.get(container)?.get(String(step)) : this.rootRaw;
    if (raw !== undefined && raw !== null) {
      return raw;
    }
    // JSON.parse turns out-of-range literals like 1e400 into Infinity, which
    // isn't JSON; only reachable when source text access is unavailable.
    return Number.isFinite(value) ? String(value) : 'null';
  }

  private summary(nodeId: number): NodeSummary {
    const node = this.getNode(nodeId);
    const { value, step } = node;
    const nodeType = jsonNodeType(value);
    const key = typeof step === 'string' ? step : null;
    const index = typeof step === 'number' ? step : null;

    let count: number | null = null;
    let scalar: string | null = null;
    let body: string;
    if (isContainer(value)) {
      count = childCount(value);
      const [open, close] = Array.isArray(value) ? ['[', ']'] : ['{', '}'];
      body = count === 0 ? `${open}${close}` : `${open}…${close}`;
    } else {
      scalar =
        typeof value === 'string'
          ? stringPreview(value)
          : typeof value === 'number'
            ? this.numberText(value, node.container, step)
            : String(value ?? null);
      body = scalar;
    }

    return {
      nodeId,
      nodeType,
      label: key !== null ? `${JSON.stringify(key)}: ${body}` : body,
      hasChildren: (count ?? 0) > 0,
      value: scalar,
      key,
      index,
      childCount: count,
    };
  }

  private serialize(
    value: JSONValue,
    container: JsonContainer | null,
    step: PathStep | null,
    indent: string,
  ): string {
    if (typeof value === 'number') {
      return this.numberText(value, container, step);
    }
    if (!isContainer(value)) {
      return JSON.stringify(value ?? null);
    }
    const inner = `${indent}  `;
    if (Array.isArray(value)) {
      if (value.length === 0) {
        return '[]';
      }
      const items = value.map((item, i) => `${inner}${this.serialize(item, value, i, inner)}`);
      return `[\n${items.join(',\n')}\n${indent}]`;
    }
    const keys = Object.keys(value);
    if (keys.length === 0) {
      return '{}';
    }
    const members = keys.map(
      (k) => `${inner}${JSON.stringify(k)}: ${this.serialize(value[k], value, k, inner)}`,
    );
    return `{\n${members.join(',\n')}\n${indent}}`;
  }
}
