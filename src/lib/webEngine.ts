/* eslint-disable @typescript-eslint/require-await -- these functions are async
   to implement the same interface as the IPC-backed native engine (tauri.ts);
   staying async also turns thrown errors into rejected promises, matching that
   backend's behavior, even where the work itself is synchronous. */
// Browser implementation of the same engine API that `tauri.ts` serves from the
// native Rust core. It runs entirely in the page: `DOMParser` parses the file,
// the browser's `document.evaluate` handles XPath, and the tree/label/paging
// semantics below are faithful ports of `native/src/{tree,xpath,document}.rs`,
// so the React UI (XmlTree, XPathPanel, ...) behaves identically against either
// backend. XSD validation is the one native-only feature -- see validateDocument.
//
// Trade-off vs. native: this holds the whole DOM in memory and can't stream, so
// it targets everyday files, not the multi-GB ones the native app is built for.
import type {
  NamespaceDefinition,
  NodeSummary,
  NodeSummaryPage,
  NodeType,
  OpenedDocument,
  XPathResult,
} from './tauri';

// Mirrors native/src/tree.rs: cap the text preview, page size for children and
// XPath node-sets. Kept identical so paging behaves the same as the native build.
const VALUE_PREVIEW_MAX = 200;
const CHILDREN_PAGE_SIZE = 500;

interface XPathCache {
  nodeId: number;
  expression: string;
  nodes: Node[];
  // Arena ids assigned lazily, per page -- null until a page containing the
  // match is built. Mirrors XPathCache in native/src/document.rs.
  ids: (number | null)[];
}

// The browser-side equivalent of Rust's OpenDocument: the parsed DOM plus the
// lazily-grown arena mapping node ids <-> DOM nodes. Node id 0 is the root
// element (see openDocument), matching the native store.
interface WebDocument {
  doc: XMLDocument;
  nodes: Node[];
  expanded: Map<number, number[]>;
  namespaces: NamespaceDefinition[] | null;
  xpathCache: XPathCache | null;
}

const store = new Map<number, WebDocument>();
let nextDocId = 0;

function getDoc(docId: number): WebDocument {
  const wd = store.get(docId);
  if (!wd) {
    throw new Error(`document ${docId} is not open`);
  }
  return wd;
}

function getNode(wd: WebDocument, nodeId: number): Node {
  const node = wd.nodes[nodeId];
  if (!node) {
    throw new Error(`node ${nodeId} not found`);
  }
  return node;
}

// Adds a node to the arena and returns its new id. Not deduplicated by identity,
// so the same DOM node can get more than one id (via tree expansion and again via
// an XPath result) -- ids are just handles, exactly as in native/src/document.rs.
function pushNode(wd: WebDocument, node: Node): number {
  const id = wd.nodes.length;
  wd.nodes.push(node);
  return id;
}

// Port of strip_non_printable (native/src/tree.rs): trim leading/trailing
// \r\n\t, drop embedded \r and \t, collapse embedded \n to a space, so multi-line
// text/comment content renders on a single tree row.
function stripNonPrintable(value: string): string {
  return value
    .replace(/^[\r\n\t]+|[\r\n\t]+$/g, '')
    .replace(/\r/g, '')
    .replace(/\n/g, ' ')
    .replace(/\t/g, '');
}

// A pretty-printed XML file has a whitespace-only text node between every pair of
// sibling elements; the tree hides these (see native/src/tree.rs). Real text
// content is never filtered, even if it has surrounding whitespace.
function isInsignificantWhitespace(node: Node): boolean {
  return node.nodeType === Node.TEXT_NODE && (node.nodeValue ?? '').trim() === '';
}

function hasVisibleChildren(node: Node): boolean {
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (!isInsignificantWhitespace(child)) {
      return true;
    }
  }
  return false;
}

function nodeTypeName(node: Node): NodeType {
  switch (node.nodeType) {
    case Node.ELEMENT_NODE:
      return 'element';
    case Node.ATTRIBUTE_NODE:
      return 'attribute';
    case Node.TEXT_NODE:
      return 'text';
    case Node.CDATA_SECTION_NODE:
      return 'cdata';
    case Node.COMMENT_NODE:
      return 'comment';
    case Node.PROCESSING_INSTRUCTION_NODE:
      return 'pi';
    case Node.DOCUMENT_NODE:
      return 'document';
    default:
      return 'other';
  }
}

// Port of simple_text_value (native/src/tree.rs): for an element whose immediate
// children are all text/cdata (no child elements), a trimmed, length-capped
// preview of its text; otherwise null. Only immediate children are scanned.
function simpleTextValue(node: Node): string | null {
  if (node.nodeType !== Node.ELEMENT_NODE) {
    return null;
  }
  let hasText = false;
  for (let child = node.firstChild; child; child = child.nextSibling) {
    if (child.nodeType === Node.ELEMENT_NODE) {
      return null;
    }
    if (
      (child.nodeType === Node.TEXT_NODE || child.nodeType === Node.CDATA_SECTION_NODE) &&
      (child.nodeValue ?? '').trim() !== ''
    ) {
      hasText = true;
    }
  }
  if (!hasText) {
    return null;
  }
  const trimmed = stripNonPrintable(node.textContent ?? '').trim();
  if (trimmed === '') {
    return null;
  }
  const chars = Array.from(trimmed);
  if (chars.length > VALUE_PREVIEW_MAX) {
    return `${chars.slice(0, VALUE_PREVIEW_MAX).join('')}…`;
  }
  return trimmed;
}

// The xmlns declarations libxml2 keeps in a separate nsDef list (so
// get_properties() excludes them) show up as ordinary attributes in the DOM;
// exclude them here so element labels match the native build's attribute set.
function isNamespaceDeclaration(attr: Attr): boolean {
  return attr.name === 'xmlns' || attr.name.startsWith('xmlns:');
}

// Port of build_label (native/src/tree.rs). Attributes are rendered sorted by
// name -- matching the native build, which sorts because libxml2 doesn't expose
// document attribute order through this crate.
function buildLabel(node: Node): string {
  if (node.nodeType === Node.COMMENT_NODE) {
    return `<!--${stripNonPrintable(node.nodeValue ?? '')} -->`;
  }
  if (node.nodeType === Node.ELEMENT_NODE) {
    const el = node as Element;
    let label = `<${el.nodeName}`;
    const attributes = Array.from(el.attributes)
      .filter((attr) => !isNamespaceDeclaration(attr))
      .map((attr) => [attr.name, attr.value] as const)
      .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    for (const [name, value] of attributes) {
      label += ` ${name}="${value}"`;
    }
    label += hasVisibleChildren(node) ? '>' : '/>';
    return label;
  }
  return stripNonPrintable(node.textContent ?? '');
}

function buildNodeSummary(nodeId: number, node: Node): NodeSummary {
  return {
    nodeId,
    nodeType: nodeTypeName(node),
    label: buildLabel(node),
    hasChildren: hasVisibleChildren(node),
    value: simpleTextValue(node),
  };
}

function pageOf(wd: WebDocument, ids: number[], offset: number): NodeSummaryPage {
  const total = ids.length;
  const items = ids
    .slice(offset, offset + CHILDREN_PAGE_SIZE)
    .map((id) => buildNodeSummary(id, getNode(wd, id)));
  return { items, offset, total, hasMore: offset + items.length < total };
}

export async function openDocument(file: File): Promise<OpenedDocument> {
  const text = await file.text();
  const dom = new DOMParser().parseFromString(text, 'application/xml');

  // DOMParser never throws: on malformed XML it returns a document whose body is
  // a <parsererror> element (in a browser-specific namespace), so detect that.
  const parserError = dom.getElementsByTagName('parsererror')[0];
  if (parserError) {
    throw new Error(`failed to parse '${file.name}': ${parserError.textContent?.trim() ?? 'invalid XML'}`);
  }

  const root = dom.documentElement;
  if (!root) {
    throw new Error('document has no root element');
  }

  const docId = nextDocId++;
  store.set(docId, {
    doc: dom,
    nodes: [root],
    expanded: new Map(),
    namespaces: null,
    xpathCache: null,
  });

  return { docId, root: buildNodeSummary(0, root) };
}

export async function closeDocument(docId: number): Promise<void> {
  store.delete(docId);
}

// Port of get_children (native/src/tree.rs): the first call assigns arena ids for
// every non-whitespace child and memoizes the id list; later calls (and pages)
// re-read the cache.
export async function getChildren(docId: number, nodeId: number, offset = 0): Promise<NodeSummaryPage> {
  const wd = getDoc(docId);
  let ids = wd.expanded.get(nodeId);
  if (!ids) {
    const node = getNode(wd, nodeId);
    ids = [];
    for (let child = node.firstChild; child; child = child.nextSibling) {
      if (!isInsignificantWhitespace(child)) {
        ids.push(pushNode(wd, child));
      }
    }
    wd.expanded.set(nodeId, ids);
  }
  return pageOf(wd, ids, offset);
}

// Port of get_node_path (native/src/tree.rs): child positions from the root
// element down to nodeId, counting only nodes the tree shows (whitespace skipped).
// An attribute resolves to its owner element's path.
export async function getNodePath(docId: number, nodeId: number): Promise<number[]> {
  const wd = getDoc(docId);
  let current: Node | null = getNode(wd, nodeId);
  if (current.nodeType === Node.ATTRIBUTE_NODE) {
    current = (current as Attr).ownerElement;
    if (!current) {
      throw new Error('attribute node has no owner element');
    }
  }

  const path: number[] = [];
  for (let parent = current.parentNode; parent; parent = current.parentNode) {
    if (parent.nodeType === Node.DOCUMENT_NODE) {
      break;
    }
    let index = 0;
    for (let sibling = current.previousSibling; sibling; sibling = sibling.previousSibling) {
      if (!isInsignificantWhitespace(sibling)) {
        index += 1;
      }
    }
    path.push(index);
    current = parent;
  }
  path.reverse();
  return path;
}

// Port of discover_namespaces (native/src/xpath.rs): collect every namespace
// declared anywhere in the document, synthesizing prefixes ("default",
// "default2", ...) for unprefixed default namespaces so XPath 1.0 (which requires
// a prefix per namespace) can still reference them. Walks in document order.
function discoverNamespaces(wd: WebDocument): NamespaceDefinition[] {
  if (wd.namespaces) {
    return wd.namespaces;
  }

  const seen = new Set<string>();
  const raw: Array<{ prefix: string; uri: string }> = [];
  for (const el of Array.from(wd.doc.getElementsByTagName('*'))) {
    for (const attr of Array.from(el.attributes)) {
      if (!isNamespaceDeclaration(attr)) {
        continue;
      }
      const prefix = attr.name === 'xmlns' ? '' : attr.name.slice('xmlns:'.length);
      const key = `${prefix} ${attr.value}`;
      if (!seen.has(key)) {
        seen.add(key);
        raw.push({ prefix, uri: attr.value });
      }
    }
  }

  let defaultCount = 0;
  const definitions = raw.map(({ prefix, uri }) => {
    if (prefix === '') {
      defaultCount += 1;
      return { prefix: defaultCount === 1 ? 'default' : `default${defaultCount}`, uri };
    }
    return { prefix, uri };
  });

  wd.namespaces = definitions;
  return definitions;
}

export async function listNamespaces(docId: number): Promise<NamespaceDefinition[]> {
  return discoverNamespaces(getDoc(docId));
}

// Port of xpath_page (native/src/xpath.rs): build one page of the cached node-set,
// assigning arena ids on demand for just this page's matches.
function xpathPage(wd: WebDocument, offset: number): NodeSummaryPage {
  const cache = wd.xpathCache;
  if (!cache) {
    throw new Error('no cached xpath result');
  }
  const total = cache.nodes.length;
  const end = Math.min(offset + CHILDREN_PAGE_SIZE, total);
  const items: NodeSummary[] = [];
  for (let i = offset; i < end; i += 1) {
    let id = cache.ids[i];
    if (id === null) {
      id = pushNode(wd, cache.nodes[i]);
      cache.ids[i] = id;
    }
    items.push(buildNodeSummary(id, getNode(wd, id)));
  }
  return { items, offset, total, hasMore: end < total };
}

// Port of evaluate_xpath (native/src/xpath.rs). A node-set comes back paged (and
// cached, so paging doesn't re-run the query); a number/string/boolean comes back
// as a scalar. Namespaces discovered in the document are exposed to the resolver.
export async function evaluateXPath(
  docId: number,
  nodeId: number,
  expression: string,
  offset = 0,
): Promise<XPathResult> {
  const wd = getDoc(docId);

  const cache = wd.xpathCache;
  if (cache && cache.nodeId === nodeId && cache.expression === expression) {
    return { kind: 'nodeset', page: xpathPage(wd, offset) };
  }

  const namespaces = discoverNamespaces(wd);
  const nsMap = new Map(namespaces.map((ns) => [ns.prefix, ns.uri]));
  // Browsers accept a plain resolver function here, but lib.dom types the
  // parameter as the XPathNSResolver object interface, so cast to satisfy both.
  const resolver = ((prefix: string | null): string | null =>
    prefix ? nsMap.get(prefix) ?? null : null) as unknown as XPathNSResolver;
  const contextNode = getNode(wd, nodeId);

  // The engine's imported `XPathResult` type (nodeset|scalar) shadows the DOM
  // global of the same name in this module, so reach the browser type/enum via
  // aliases: `DomXPath` (the evaluation-result object) and `DomXPathCtor` (its
  // NUMBER_TYPE/STRING_TYPE/... constants).
  let result: DomXPath;
  try {
    result = wd.doc.evaluate(expression, contextNode, resolver, DomXPathCtor.ANY_TYPE, null);
  } catch {
    throw new Error(`invalid xpath expression: ${expression}`);
  }

  switch (result.resultType) {
    case DomXPathCtor.NUMBER_TYPE:
      wd.xpathCache = null;
      return { kind: 'scalar', valueType: 'number', value: String(result.numberValue) };
    case DomXPathCtor.STRING_TYPE:
      wd.xpathCache = null;
      return { kind: 'scalar', valueType: 'string', value: result.stringValue };
    case DomXPathCtor.BOOLEAN_TYPE:
      wd.xpathCache = null;
      return { kind: 'scalar', valueType: 'boolean', value: String(result.booleanValue) };
    default: {
      const nodes: Node[] = [];
      for (let node = result.iterateNext(); node; node = result.iterateNext()) {
        nodes.push(node);
      }
      wd.xpathCache = { nodeId, expression, nodes, ids: nodes.map(() => null) };
      return { kind: 'nodeset', page: xpathPage(wd, offset) };
    }
  }
}

const DomXPathCtor = globalThis.XPathResult;
type DomXPath = ReturnType<XMLDocument['evaluate']>;

// Note: there is no validateDocument here. Real XSD validation needs libxml2 plus
// filesystem access to resolve xsi:schemaLocation schema files, neither of which
// the browser offers -- it's native-only. The web ValidatePanel shows an
// explanatory note instead of calling the engine (see engine.validateDocument).

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;' };

function escapeText(value: string): string {
  return value.replace(/[&<>]/g, (c) => XML_ESCAPES[c]);
}

function escapeAttr(value: string): string {
  return value.replace(/[&<>"]/g, (c) => (c === '"' ? '&quot;' : XML_ESCAPES[c]));
}

// Indented outer XML, mirroring the intent of get_formatted_outer_xml
// (native/src/format.rs, which calls libxml2's xmlNodeDump with the format flag):
// a 2-space-per-level pretty-print. Elements with only text content stay inline;
// insignificant whitespace is dropped so re-indentation is clean.
function serializeNode(node: Node, indent: string): string {
  switch (node.nodeType) {
    case Node.ELEMENT_NODE: {
      const el = node as Element;
      let open = `<${el.nodeName}`;
      for (const attr of Array.from(el.attributes)) {
        open += ` ${attr.name}="${escapeAttr(attr.value)}"`;
      }
      const kids = Array.from(el.childNodes).filter((c) => !isInsignificantWhitespace(c));
      if (kids.length === 0) {
        return `${indent}${open}/>`;
      }
      const onlyText = kids.every(
        (c) => c.nodeType === Node.TEXT_NODE || c.nodeType === Node.CDATA_SECTION_NODE,
      );
      if (onlyText) {
        const inner = kids.map((c) => serializeInline(c)).join('');
        return `${indent}${open}>${inner}</${el.nodeName}>`;
      }
      const inner = kids.map((c) => serializeNode(c, `${indent}  `)).join('\n');
      return `${indent}${open}>\n${inner}\n${indent}</${el.nodeName}>`;
    }
    case Node.TEXT_NODE:
      return `${indent}${escapeText((node.nodeValue ?? '').trim())}`;
    case Node.CDATA_SECTION_NODE:
      return `${indent}<![CDATA[${node.nodeValue ?? ''}]]>`;
    case Node.COMMENT_NODE:
      return `${indent}<!--${node.nodeValue ?? ''}-->`;
    case Node.PROCESSING_INSTRUCTION_NODE:
      return `${indent}<?${(node as ProcessingInstruction).target} ${node.nodeValue ?? ''}?>`;
    default:
      return '';
  }
}

function serializeInline(node: Node): string {
  if (node.nodeType === Node.CDATA_SECTION_NODE) {
    return `<![CDATA[${node.nodeValue ?? ''}]]>`;
  }
  return escapeText(node.nodeValue ?? '');
}

export async function getFormattedOuterXml(docId: number, nodeId: number): Promise<string> {
  const wd = getDoc(docId);
  return serializeNode(getNode(wd, nodeId), '');
}
