import { invoke } from '@tauri-apps/api/core';

export type NodeType = 'element' | 'attribute' | 'text' | 'cdata' | 'comment' | 'pi' | 'document' | 'other';

export interface NodeSummary {
  nodeId: number;
  nodeType: NodeType;
  label: string;
  hasChildren: boolean;
  // A text-content preview for plain-text leaf elements (e.g. "Widget 0" for
  // <name>Widget 0</name>); null otherwise. Shown in XPath results.
  value: string | null;
}

export interface OpenedDocument {
  docId: number;
  root: NodeSummary;
}

export interface NamespaceDefinition {
  prefix: string;
  uri: string;
}

export interface ValidationIssue {
  severity: 'error' | 'warning';
  line: number | null;
  col: number | null;
  message: string;
}

export interface NodeSummaryPage {
  items: NodeSummary[];
  offset: number;
  total: number;
  hasMore: boolean;
}

// An XPath query yields either a node-set (paged, like getChildren) or a scalar
// (count()/string()/boolean tests), mirroring the Rust XPathResult enum.
export type XPathResult =
  | { kind: 'nodeset'; page: NodeSummaryPage }
  | { kind: 'scalar'; valueType: string; value: string };

// Tauri's default IPC serialization uses each Rust field's name as-is (snake_case),
// it does not camelCase for us, so the wrappers below remap explicitly.
interface RawNodeSummary {
  node_id: number;
  node_type: NodeType;
  label: string;
  has_children: boolean;
  value: string | null;
}

interface RawOpenedDocument {
  doc_id: number;
  root: RawNodeSummary;
}

interface RawNodeSummaryPage {
  items: RawNodeSummary[];
  offset: number;
  total: number;
  has_more: boolean;
}

type RawXPathResult =
  | { kind: 'nodeset'; page: RawNodeSummaryPage }
  | { kind: 'scalar'; value_type: string; value: string };

function fromRawNode(raw: RawNodeSummary): NodeSummary {
  return {
    nodeId: raw.node_id,
    nodeType: raw.node_type,
    label: raw.label,
    hasChildren: raw.has_children,
    value: raw.value,
  };
}

function fromRawPage(raw: RawNodeSummaryPage): NodeSummaryPage {
  return { items: raw.items.map(fromRawNode), offset: raw.offset, total: raw.total, hasMore: raw.has_more };
}

export async function openDocument(path: string): Promise<OpenedDocument> {
  const raw = await invoke<RawOpenedDocument>('open_document_cmd', { path });
  return { docId: raw.doc_id, root: fromRawNode(raw.root) };
}

export async function closeDocument(docId: number): Promise<void> {
  await invoke('close_document_cmd', { docId });
}

export async function getChildren(docId: number, nodeId: number, offset = 0): Promise<NodeSummaryPage> {
  const raw = await invoke<RawNodeSummaryPage>('get_children_cmd', { docId, nodeId, offset });
  return fromRawPage(raw);
}

// The child-index path from the root element down to nodeId (skipping the
// whitespace the tree hides), used to reveal/select a node in the lazy tree.
export async function getNodePath(docId: number, nodeId: number): Promise<number[]> {
  return invoke<number[]>('get_node_path_cmd', { docId, nodeId });
}

export async function listNamespaces(docId: number): Promise<NamespaceDefinition[]> {
  return invoke<NamespaceDefinition[]>('list_namespaces_cmd', { docId });
}

export async function evaluateXPath(
  docId: number,
  nodeId: number,
  expression: string,
  offset = 0,
): Promise<XPathResult> {
  const raw = await invoke<RawXPathResult>('evaluate_xpath_cmd', { docId, nodeId, expression, offset });
  if (raw.kind === 'nodeset') {
    return { kind: 'nodeset', page: fromRawPage(raw.page) };
  }
  return { kind: 'scalar', valueType: raw.value_type, value: raw.value };
}

export async function validateDocument(docId: number): Promise<ValidationIssue[]> {
  return invoke<ValidationIssue[]>('validate_document_cmd', { docId });
}

export async function getFormattedOuterXml(docId: number, nodeId: number): Promise<string> {
  return invoke<string>('get_formatted_outer_xml_cmd', { docId, nodeId });
}
