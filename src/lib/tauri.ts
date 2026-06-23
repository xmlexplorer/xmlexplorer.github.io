import { invoke } from '@tauri-apps/api/core';

export type NodeType = 'element' | 'attribute' | 'text' | 'cdata' | 'comment' | 'pi' | 'document' | 'other';

export interface NodeSummary {
  nodeId: number;
  nodeType: NodeType;
  label: string;
  hasChildren: boolean;
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

// Tauri's default IPC serialization uses each Rust field's name as-is (snake_case),
// it does not camelCase for us, so the wrappers below remap explicitly.
interface RawNodeSummary {
  node_id: number;
  node_type: NodeType;
  label: string;
  has_children: boolean;
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

function fromRawNode(raw: RawNodeSummary): NodeSummary {
  return { nodeId: raw.node_id, nodeType: raw.node_type, label: raw.label, hasChildren: raw.has_children };
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
  return { items: raw.items.map(fromRawNode), offset: raw.offset, total: raw.total, hasMore: raw.has_more };
}

export async function listNamespaces(docId: number): Promise<NamespaceDefinition[]> {
  return invoke<NamespaceDefinition[]>('list_namespaces_cmd', { docId });
}

export async function evaluateXPath(docId: number, nodeId: number, expression: string): Promise<NodeSummary[]> {
  const raw = await invoke<RawNodeSummary[]>('evaluate_xpath_cmd', { docId, nodeId, expression });
  return raw.map(fromRawNode);
}

export async function validateDocument(docId: number): Promise<ValidationIssue[]> {
  return invoke<ValidationIssue[]>('validate_document_cmd', { docId });
}

export async function getFormattedOuterXml(docId: number, nodeId: number): Promise<string> {
  return invoke<string>('get_formatted_outer_xml_cmd', { docId, nodeId });
}
