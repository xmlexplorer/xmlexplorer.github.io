use libxml::parser::Parser;
use libxml::tree::{Document, Node};
use serde::Serialize;
use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;

use crate::tree::{build_node_summary, NodeSummary};

/// An XML document opened in the engine, plus the arena of nodes we've
/// handed out ids for so far. Nodes are only added to the arena lazily,
/// as they're discovered via `get_children`/`evaluate_xpath`, mirroring
/// the original app's on-expand tree loading.
pub struct OpenDocument {
    pub doc: Document,
    pub path: String,
    pub nodes: Vec<Node>,
    /// node_id -> child node_ids, memoized so re-expanding a node doesn't
    /// allocate duplicate arena entries.
    pub expanded: HashMap<u64, Vec<u64>>,
    /// (prefix, uri) pairs discovered by `xpath::discover_namespaces`, memoized
    /// since computing it requires walking every element in the document --
    /// expensive to redo on every `evaluate_xpath` call on a large document.
    pub namespaces_cache: Option<Vec<(String, String)>>,
}

// SAFETY: libxml2's `Document`/`Node` wrap `Rc<RefCell<_>>` internally, so they
// aren't `Send` by default. `OpenDocument` is only ever touched from inside
// `DocumentStore::with_document_mut`, which holds the store's `Mutex` for the
// whole closure -- access across threads is always fully serialized, and no
// `Node`/`Document` value is ever cloned out of that closure and retained
// elsewhere. That's the actual invariant `Send` is asserting here; the
// compiler just can't see through the `Rc<RefCell<_>>` to know it holds.
unsafe impl Send for OpenDocument {}

#[derive(Default)]
pub struct DocumentStore {
    documents: Mutex<HashMap<u64, OpenDocument>>,
    next_doc_id: AtomicU64,
}

#[derive(Serialize)]
pub struct OpenedDocument {
    pub doc_id: u64,
    pub root: NodeSummary,
}

impl DocumentStore {
    pub fn open(&self, path: &str) -> Result<OpenedDocument, String> {
        let doc = Parser::default()
            .parse_file(path)
            .map_err(|e| format!("failed to parse '{path}': {e}"))?;

        let root = doc
            .get_root_element()
            .ok_or_else(|| "document has no root element".to_string())?;

        let root_summary = build_node_summary(0, &root);

        let open_doc = OpenDocument {
            doc,
            path: path.to_string(),
            nodes: vec![root],
            expanded: HashMap::new(),
            namespaces_cache: None,
        };

        let doc_id = self.next_doc_id.fetch_add(1, Ordering::SeqCst);
        self.documents.lock().unwrap().insert(doc_id, open_doc);

        Ok(OpenedDocument {
            doc_id,
            root: root_summary,
        })
    }

    pub fn close(&self, doc_id: u64) {
        self.documents.lock().unwrap().remove(&doc_id);
    }

    /// Runs `f` with exclusive access to the given open document, for
    /// commands that need to read and/or extend the node arena.
    pub fn with_document_mut<T>(
        &self,
        doc_id: u64,
        f: impl FnOnce(&mut OpenDocument) -> Result<T, String>,
    ) -> Result<T, String> {
        let mut documents = self.documents.lock().map_err(|_| "lock poisoned".to_string())?;
        let open_doc = documents
            .get_mut(&doc_id)
            .ok_or_else(|| format!("document {doc_id} is not open"))?;
        f(open_doc)
    }
}

#[tauri::command]
pub fn open_document_cmd(
    store: tauri::State<'_, DocumentStore>,
    path: String,
) -> Result<OpenedDocument, String> {
    store.open(&path)
}

#[tauri::command]
pub fn close_document_cmd(store: tauri::State<'_, DocumentStore>, doc_id: u64) {
    store.close(doc_id)
}

impl OpenDocument {
    pub fn get_node(&self, node_id: u64) -> Result<&Node, String> {
        self.nodes
            .get(node_id as usize)
            .ok_or_else(|| format!("node {node_id} not found"))
    }

    /// Adds a node to the arena and returns its newly assigned id.
    /// Note: nodes are not deduplicated by underlying identity, so the same
    /// underlying XML node may end up with more than one id (e.g. once via
    /// tree expansion and again via an XPath result) -- that's fine, ids are
    /// just handles, not a claim of canonical identity.
    pub fn push_node(&mut self, node: Node) -> u64 {
        let id = self.nodes.len() as u64;
        self.nodes.push(node);
        id
    }
}
