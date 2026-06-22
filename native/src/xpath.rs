use libxml::tree::NodeType;
use libxml::xpath::Context;
use serde::Serialize;
use std::collections::HashSet;

use crate::document::{DocumentStore, OpenDocument};
use crate::tree::{build_node_summary, NodeSummary};

#[derive(Serialize, Clone)]
pub struct NamespaceDefinition {
    pub prefix: String,
    pub uri: String,
}

/// Walks every element in the document collecting namespace declarations,
/// synthesizing prefixes ("default", "default2", ...) for unprefixed default
/// namespaces so they can still be referenced in XPath 1.0 expressions
/// (which require every namespace to have a prefix). Mirrors
/// XPathNavigatorTreeView.LoadNamespaceDefinitions.
///
/// Memoized on `OpenDocument` -- walking every element is too expensive to
/// redo on every `evaluate_xpath` call on a large document.
fn discover_namespaces(open_doc: &mut OpenDocument) -> Result<Vec<NamespaceDefinition>, String> {
    if let Some(cached) = &open_doc.namespaces_cache {
        return Ok(cached
            .iter()
            .map(|(prefix, uri)| NamespaceDefinition {
                prefix: prefix.clone(),
                uri: uri.clone(),
            })
            .collect());
    }

    let root = open_doc.get_node(0)?.clone();

    let mut raw = Vec::new();
    let mut raw_seen = HashSet::new();
    // Walk via get_first_child/get_next_sibling directly rather than
    // get_child_nodes(), which heap-allocates a fresh Vec per node -- on a
    // multi-million-node document that allocation overhead alone is the
    // difference between this being a one-time blip and a multi-second stall.
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        if node.get_type() == Some(NodeType::ElementNode) {
            for ns in node.get_namespace_declarations() {
                let key = (ns.get_prefix(), ns.get_href());
                if raw_seen.insert(key.clone()) {
                    raw.push(key);
                }
            }
        }
        let mut child = node.get_first_child();
        while let Some(c) = child {
            let next = c.get_next_sibling();
            stack.push(c);
            child = next;
        }
    }

    let mut default_count = 0;
    let definitions: Vec<NamespaceDefinition> = raw
        .into_iter()
        .map(|(prefix, uri)| {
            let prefix = if prefix.is_empty() {
                default_count += 1;
                if default_count == 1 {
                    "default".to_string()
                } else {
                    format!("default{default_count}")
                }
            } else {
                prefix
            };
            NamespaceDefinition { prefix, uri }
        })
        .collect();

    open_doc.namespaces_cache = Some(
        definitions
            .iter()
            .map(|d| (d.prefix.clone(), d.uri.clone()))
            .collect(),
    );

    Ok(definitions)
}

pub fn list_namespaces(store: &DocumentStore, doc_id: u64) -> Result<Vec<NamespaceDefinition>, String> {
    store.with_document_mut(doc_id, discover_namespaces)
}

/// Evaluates `expression` with `node_id` as the context node, with every
/// namespace declared anywhere in the document registered under its
/// (possibly synthesized) prefix -- mirrors `XPathNavigator.Evaluate(xpath,
/// namespaceManager)`. Result nodes get fresh arena ids, same as
/// `get_children`.
pub fn evaluate_xpath(
    store: &DocumentStore,
    doc_id: u64,
    node_id: u64,
    expression: &str,
) -> Result<Vec<NodeSummary>, String> {
    store.with_document_mut(doc_id, |open_doc| {
        let namespaces = discover_namespaces(open_doc)?;
        let context_node = open_doc.get_node(node_id)?.clone();

        let mut context = Context::new(&open_doc.doc)
            .map_err(|_| "failed to create xpath context".to_string())?;
        context
            .set_context_node(&context_node)
            .map_err(|_| "failed to set xpath context node".to_string())?;
        for ns in &namespaces {
            context
                .register_namespace(&ns.prefix, &ns.uri)
                .map_err(|_| format!("invalid namespace prefix '{}'", ns.prefix))?;
        }

        let result = context
            .evaluate(expression)
            .map_err(|_| format!("invalid xpath expression: {expression}"))?;

        result
            .get_nodes_as_vec()
            .into_iter()
            .map(|node| {
                let id = open_doc.push_node(node);
                open_doc.get_node(id).map(|n| build_node_summary(id, n))
            })
            .collect()
    })
}

#[tauri::command]
pub fn list_namespaces_cmd(
    store: tauri::State<'_, DocumentStore>,
    doc_id: u64,
) -> Result<Vec<NamespaceDefinition>, String> {
    list_namespaces(store.inner(), doc_id)
}

#[tauri::command]
pub fn evaluate_xpath_cmd(
    store: tauri::State<'_, DocumentStore>,
    doc_id: u64,
    node_id: u64,
    expression: String,
) -> Result<Vec<NodeSummary>, String> {
    evaluate_xpath(store.inner(), doc_id, node_id, &expression)
}
