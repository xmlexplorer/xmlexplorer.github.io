// The engine facade the UI talks to. It forwards each call to the native Rust
// core (via Tauri IPC, `tauri.ts`) when running inside the desktop app, or to the
// in-browser DOM implementation (`webEngine.ts`) when running as a plain web page.
// Both back ends implement the same contract, so components import from here and
// stay backend-agnostic -- the only seam is openDocument, which takes a native
// filesystem path on desktop and a browser File in the web build.
import { isDesktop } from './platform';
import * as tauri from './tauri';
import * as web from './webEngine';

export type {
  DocumentFormat,
  NodeType,
  NodeSummary,
  OpenedDocument,
  NamespaceDefinition,
  ValidationIssue,
  NodeSummaryPage,
  XPathResult,
} from './tauri';

import type {
  NamespaceDefinition,
  NodeSummaryPage,
  OpenedDocument,
  ValidationIssue,
  XPathResult,
} from './tauri';

export async function openDocument(source: string | File): Promise<OpenedDocument> {
  if (isDesktop()) {
    if (typeof source !== 'string') {
      throw new Error('native openDocument expects a file path');
    }
    // The native engine is XML-only for now; fail clearly rather than with a
    // libxml2 "Start tag expected" error.
    if (/\.json$/i.test(source)) {
      throw new Error('JSON files are not yet supported in the desktop app. Open them at https://xmlexplorer.github.io.');
    }
    return tauri.openDocument(source);
  }
  if (typeof source === 'string') {
    throw new Error('web openDocument expects a File');
  }
  return web.openDocument(source);
}

export async function closeDocument(docId: number): Promise<void> {
  return isDesktop() ? tauri.closeDocument(docId) : web.closeDocument(docId);
}

export async function getChildren(docId: number, nodeId: number, offset = 0): Promise<NodeSummaryPage> {
  return isDesktop() ? tauri.getChildren(docId, nodeId, offset) : web.getChildren(docId, nodeId, offset);
}

export async function getNodePath(docId: number, nodeId: number): Promise<number[]> {
  return isDesktop() ? tauri.getNodePath(docId, nodeId) : web.getNodePath(docId, nodeId);
}

export async function listNamespaces(docId: number): Promise<NamespaceDefinition[]> {
  return isDesktop() ? tauri.listNamespaces(docId) : web.listNamespaces(docId);
}

// XPath for XML documents (relative to the context node `nodeId`), JSONPath for
// JSON documents (always from the document root).
export async function evaluateQuery(
  docId: number,
  nodeId: number,
  expression: string,
  offset = 0,
): Promise<XPathResult> {
  return isDesktop()
    ? tauri.evaluateXPath(docId, nodeId, expression, offset)
    : web.evaluateQuery(docId, nodeId, expression, offset);
}

// Native-only: XSD schema validation needs libxml2 + filesystem access, which the
// browser can't provide. The web ValidatePanel shows an explanatory note rather
// than calling this, so reaching here in a browser build is a bug.
export async function validateDocument(docId: number): Promise<ValidationIssue[]> {
  if (!isDesktop()) {
    throw new Error('XSD schema validation is only available in the desktop app');
  }
  return tauri.validateDocument(docId);
}

// The node pretty-printed in its document's own format: outer XML, or JSON.
export async function getFormattedSource(docId: number, nodeId: number): Promise<string> {
  return isDesktop() ? tauri.getFormattedOuterXml(docId, nodeId) : web.getFormattedSource(docId, nodeId);
}
